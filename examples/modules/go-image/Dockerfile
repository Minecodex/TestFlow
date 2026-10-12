FROM golang:1.26-alpine AS build
WORKDIR /app
COPY go.mod go.sum ./
COPY vendor ./vendor
COPY main.go ./
RUN CGO_ENABLED=0 go build -mod=vendor -o /module .
FROM alpine:3.23
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=build /module ./module
COPY manifest.json ./
COPY schemas ./schemas
USER 10001:10001
ENTRYPOINT ["/app/module"]
