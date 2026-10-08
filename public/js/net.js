// WebSocket 래퍼: JSON 메시지, 자동 재접속.
export class Net {
  constructor(onMessage, onStatus) {
    this.onMessage = onMessage; this.onStatus = onStatus;
    this.url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
    this.ws = null; this.closed = false; this.retry = 0;
    this.connect();
  }
  connect() {
    const ws = this.ws = new WebSocket(this.url);
    ws.onopen = () => { this.retry = 0; this.onStatus('open'); };
    ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; } this.onMessage(m); };
    ws.onclose = () => {
      this.onStatus('closed');
      if (this.closed) return;
      const wait = Math.min(8000, 800 * 2 ** this.retry++);
      setTimeout(() => this.connect(), wait);
    };
    ws.onerror = () => {};
  }
  get open() { return this.ws && this.ws.readyState === WebSocket.OPEN; }
  send(msg) { if (this.open) this.ws.send(JSON.stringify(msg)); }
  close() { this.closed = true; this.ws?.close(); }
}
