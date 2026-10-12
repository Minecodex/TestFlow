package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/color"
	_ "image/jpeg"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"reflect"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type Invocation struct {
	Body            map[string]interface{}
	State           string
	Socket          *websocket.Conn
	Context         context.Context
	Cancel          context.CancelFunc
	CancelRequested bool
	Lock            sync.Mutex
}

var invocations = map[string]*Invocation{}
var store sync.Mutex
var contract map[string]interface{}
var client = &http.Client{Timeout: 20 * time.Second}

func jsonFile(name string) interface{} {
	data, err := os.ReadFile(name)
	if err != nil {
		panic(err)
	}
	var value interface{}
	if err := json.Unmarshal(data, &value); err != nil {
		panic(err)
	}
	return value
}

func response(w http.ResponseWriter, value interface{}) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(value)
}

func terminal(state string) bool {
	return state == "completed" || state == "failed" || state == "canceled"
}

func handler(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	if path == "/module/v1/health" && r.Method == http.MethodGet {
		response(w, map[string]interface{}{"ready": true})
		return
	}
	if path == "/module/v1/contract" && r.Method == http.MethodGet {
		response(w, contract)
		return
	}
	if path == "/module/v1/executions" && r.Method == http.MethodPost {
		var body map[string]interface{}
		if json.NewDecoder(io.LimitReader(r.Body, 1024*1024)).Decode(&body) != nil {
			http.Error(w, "Invalid execution body", http.StatusBadRequest)
			return
		}
		id, _ := body["invocation_id"].(string)
		if id == "" {
			http.Error(w, "invocation_id is required", http.StatusBadRequest)
			return
		}
		store.Lock()
		existing := invocations[id]
		if existing != nil && !reflect.DeepEqual(existing.Body, body) {
			store.Unlock()
			http.Error(w, "Invocation identity conflict", http.StatusConflict)
			return
		}
		if existing == nil {
			ctx, cancel := context.WithCancel(context.Background())
			invocations[id] = &Invocation{Body: body, State: "created", Context: ctx, Cancel: cancel}
		}
		store.Unlock()
		response(w, map[string]string{"invocation_id": id})
		return
	}
	if !strings.HasPrefix(path, "/module/v1/executions/") {
		http.NotFound(w, r)
		return
	}
	parts := strings.Split(strings.TrimPrefix(path, "/module/v1/executions/"), "/")
	id := parts[0]
	store.Lock()
	invocation := invocations[id]
	store.Unlock()
	if invocation == nil {
		http.NotFound(w, r)
		return
	}
	if len(parts) == 2 && parts[1] == "stream" && r.Method == http.MethodGet {
		invocation.Lock.Lock()
		if invocation.State != "created" {
			invocation.Lock.Unlock()
			http.Error(w, "Invocation already started or ended", http.StatusConflict)
			return
		}
		upgrader := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}
		socket, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			invocation.Lock.Unlock()
			return
		}
		invocation.Socket, invocation.State = socket, "running"
		invocation.Lock.Unlock()
		defer socket.Close()
		run(id, invocation)
		return
	}
	invocation.Lock.Lock()
	defer invocation.Lock.Unlock()
	if len(parts) == 2 && parts[1] == "cancel" && r.Method == http.MethodPost {
		if !terminal(invocation.State) {
			invocation.CancelRequested = true
			invocation.Cancel()
			// Before stream attachment no worker exists. Otherwise the worker confirms its own stop.
			if invocation.State == "created" {
				invocation.State = "canceled"
			}
		}
		response(w, map[string]interface{}{"accepted": true, "state": invocation.State})
		return
	}
	if len(parts) == 1 && r.Method == http.MethodGet {
		response(w, map[string]interface{}{"invocation_id": id, "state": invocation.State})
		return
	}
	http.NotFound(w, r)
}

// Only the worker writes to its WebSocket. HTTP cancellation never races a socket write.
func send(id string, invocation *Invocation, kind string, data map[string]interface{}) error {
	if err := invocation.Context.Err(); err != nil {
		return err
	}
	data["type"], data["invocation_id"] = kind, id
	_ = invocation.Socket.SetWriteDeadline(time.Now().Add(5 * time.Second))
	return invocation.Socket.WriteJSON(data)
}

func run(id string, invocation *Invocation) {
	var processError error
	defer func() {
		if recover() != nil {
			processError = errors.New("Invalid invocation data")
		}
		invocation.Lock.Lock()
		state := "completed"
		if invocation.CancelRequested {
			state = "canceled"
		} else if processError != nil {
			state = "failed"
		}
		invocation.State = state
		invocation.Lock.Unlock()
		// Processing and outstanding HTTP work actually returned before this confirmation.
		event := map[string]interface{}{"invocation_id": id}
		switch state {
		case "completed":
			event["type"] = "execution.completed"
		case "canceled":
			event["type"], event["remote_stop_confirmed"] = "execution.canceled", true
		default:
			event["type"], event["code"], event["message"] = "execution.error", "image_processing", "Image processing or platform resource access failed"
		}
		_ = invocation.Socket.SetWriteDeadline(time.Now().Add(5 * time.Second))
		_ = invocation.Socket.WriteJSON(event)
		invocation.Cancel()
	}()
	processError = process(id, invocation)
}

func process(id string, invocation *Invocation) error {
	body := invocation.Body
	traceContext := body["context"].(map[string]interface{})
	parameters := body["parameters"].(map[string]interface{})
	input := body["inputs"].(map[string]interface{})["image"].(map[string]interface{})["value"].(map[string]interface{})
	root, runtime, token := os.Getenv("TESTFLOW_PLATFORM_URL"), os.Getenv("TESTFLOW_RUNTIME_ID"), os.Getenv("TESTFLOW_RUNTIME_TOKEN")
	execution := traceContext["execution_id"].(string)
	endpoint := root + "/api/v1/module-resources/" + runtime + "/assets/" + input["asset_id"].(string) +
		"?version=" + fmt.Sprint(input["asset_version"]) + "&execution_id=" + url.QueryEscape(execution)
	request, err := http.NewRequestWithContext(invocation.Context, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+token)
	result, err := client.Do(request)
	if err != nil {
		return err
	}
	defer result.Body.Close()
	if result.StatusCode != http.StatusOK {
		return errors.New("Input read failed")
	}
	source, _, err := image.Decode(io.LimitReader(result.Body, 50*1024*1024))
	if err != nil {
		return err
	}
	bounds := source.Bounds()
	width, height := bounds.Dx(), bounds.Dy()
	maxWidth := int(parameters["max_width"].(float64))
	if width < 1 || height < 1 || maxWidth < 1 {
		return errors.New("Invalid dimensions")
	}
	if width > maxWidth {
		height, width = height*maxWidth/width, maxWidth
	}
	if height < 1 {
		height = 1
	}
	target := image.NewRGBA(image.Rect(0, 0, width, height))
	var sum uint64
	for y := 0; y < height; y++ {
		if err := invocation.Context.Err(); err != nil {
			return err
		}
		for x := 0; x < width; x++ {
			pixel := source.At(bounds.Min.X+x*bounds.Dx()/width, bounds.Min.Y+y*bounds.Dy()/height)
			red, green, blue, _ := pixel.RGBA()
			gray := uint8((299*red + 587*green + 114*blue) / 1000 >> 8)
			sum += uint64(gray)
			target.Set(x, y, color.RGBA{gray, gray, gray, 255})
		}
	}
	var pngData bytes.Buffer
	if err := png.Encode(&pngData, target); err != nil {
		return err
	}
	if err := invocation.Context.Err(); err != nil {
		return err
	}
	var payload bytes.Buffer
	writer := multipart.NewWriter(&payload)
	file, err := writer.CreateFormFile("file", "grayscale.png")
	if err != nil {
		return err
	}
	if _, err := io.Copy(file, &pngData); err != nil {
		return err
	}
	if err := writer.Close(); err != nil {
		return err
	}
	outputURL := root + "/api/v1/module-resources/" + runtime + "/assets?execution_id=" + url.QueryEscape(execution) + "&type=Image&format=" + url.QueryEscape("Image/*")
	request, err = http.NewRequestWithContext(invocation.Context, http.MethodPost, outputURL, &payload)
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	output, err := client.Do(request)
	if err != nil {
		return err
	}
	defer output.Body.Close()
	if output.StatusCode != http.StatusOK {
		return errors.New("Output upload failed")
	}
	var reference map[string]interface{}
	if err := json.NewDecoder(output.Body).Decode(&reference); err != nil {
		return err
	}
	if err := send(id, invocation, "trace", map[string]interface{}{"trace_id": traceContext["trace_id"], "parent_span_id": traceContext["span_id"], "span_id": id + "-pixels", "name": "grayscale_resize", "width": width, "height": height}); err != nil {
		return err
	}
	mean := sum / uint64(width*height)
	outputs := []map[string]interface{}{
		{"field": "image", "value": reference},
		{"field": "caption", "value": fmt.Sprintf("%dx%d grayscale; mean=%d", width, height, mean)},
		{"field": "stats", "value": map[string]interface{}{"width": width, "height": height, "mean": mean}},
	}
	for _, data := range outputs {
		if err := send(id, invocation, "output.value", data); err != nil {
			return err
		}
	}
	return nil
}

func main() {
	manifest := jsonFile("/app/manifest.json").(map[string]interface{})
	contract = map[string]interface{}{"protocol": manifest["protocol"], "id": manifest["id"], "version": manifest["version"], "inputs": jsonFile("/app/schemas/inputs.json"), "outputs": jsonFile("/app/schemas/outputs.json"), "parameters": jsonFile("/app/schemas/parameters.json")}
	port := os.Getenv("TESTFLOW_MODULE_PORT")
	if port == "" {
		port = "8080"
	}
	server := &http.Server{Addr: ":" + port, Handler: http.HandlerFunc(handler), ReadHeaderTimeout: 5 * time.Second}
	if err := server.ListenAndServe(); err != nil {
		panic(err)
	}
}
