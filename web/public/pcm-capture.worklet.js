class TestFlowPcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const samples = inputs[0]?.[0];
    if (samples) {
      const bytes = new Uint8Array(samples.length * 2);
      const view = new DataView(bytes.buffer);
      for (let i = 0; i < samples.length; i++) view.setInt16(i * 2, Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), true);
      this.port.postMessage(bytes.buffer, [bytes.buffer]);
    }
    return true;
  }
}
registerProcessor('testflow-pcm-capture', TestFlowPcmCapture);
