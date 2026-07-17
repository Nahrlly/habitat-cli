export {};

const url = process.argv[2];
if (!url) {
  console.error("Usage: deployment-ws-smoke.ts <ws-url>");
  process.exit(2);
}

const timeoutMs = 5_000;
const socket = new WebSocket(url);

await new Promise<void>((resolve, reject) => {
  const timeout = setTimeout(() => {
    socket.close();
    reject(new Error(`Timed out waiting for WebSocket snapshot from ${url}`));
  }, timeoutMs);

  socket.onerror = () => {
    clearTimeout(timeout);
    reject(new Error(`WebSocket connection failed for ${url}`));
  };

  socket.onmessage = (event) => {
    clearTimeout(timeout);
    try {
      const message = JSON.parse(String(event.data)) as {
        type?: string;
        snapshot?: unknown;
      };
      if (message.type !== "snapshot" || !message.snapshot || typeof message.snapshot !== "object") {
        throw new Error("first WebSocket frame was not an initial snapshot");
      }
      console.log(`Habitat WebSocket smoke test passed for ${url}`);
      socket.close();
      resolve();
    } catch (error) {
      socket.close();
      reject(error);
    }
  };
});
