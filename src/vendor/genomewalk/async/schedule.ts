// Let progress paint during long local scans. A fresh channel closes after each
// yield, so importing this module creates no timers or open Node handles.
export function yieldToLoop() {
  if (typeof MessageChannel === "undefined")
    return new Promise<void>((resolve) => setTimeout(resolve, 0));
  return new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(0);
  });
}
