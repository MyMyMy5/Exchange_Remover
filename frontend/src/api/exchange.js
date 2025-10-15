import client from "./client";

export const fetchMailboxes = async () => {
  const { data } = await client.get("/mailboxes");
  return data.mailboxes || [];
};

export const searchMessages = async (filters) => {
  const { data } = await client.post("/search", filters);
  return data;
};

export const purgeSender = async (payload) => {
  const { data } = await client.post("/purge-sender", payload);
  return data;
};
export const cancelPurge = async (requestId) => {
  const { data } = await client.post("/purge-sender/cancel", { requestId });
  return data;
};
export const fetchPurgeLogs = async () => {
  const { data } = await client.get("/purge-logs");
  return data.logs || [];
};

// Streaming purge API using fetch + SSE parsing
export const purgeSenderStream = (payload, onEvent) => {
  const controller = new AbortController();
  const baseURL = (import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api").replace(/\/+$/, "");
  const url = `${baseURL}/purge-sender?stream=true`;

  const headers = {
    Accept: "text/event-stream",
    "Content-Type": "application/json"
  };

  const decoder = new TextDecoder();

  const parseSSEEvent = (raw) => {
    const lines = raw.split(/\r?\n/);
    let event = "message";
    const dataLines = [];
    for (const line of lines) {
      if (line.startsWith("event:")) {
        event = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trim());
      }
    }
    let data;
    const joined = dataLines.join("\n");
    try {
      data = joined ? JSON.parse(joined) : null;
    } catch (_) {
      data = { raw: joined };
    }
    return { type: event, data };
  };

  fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: controller.signal
  })
    .then(async (response) => {
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        onEvent?.({ type: "error", data: { message: `HTTP ${response.status}`, body: text } });
        return;
      }

      const reader = response.body.getReader();
      let buffer = "";

      const pump = async () => {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;

          let idx;
          while ((idx = buffer.indexOf("\n\n")) !== -1) {
            const raw = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const evt = parseSSEEvent(raw);
            if (evt) onEvent?.(evt);
          }
        }
      };

      try {
        await pump();
      } catch (err) {
        if (!controller.signal.aborted) {
          onEvent?.({ type: "error", data: { message: err.message } });
        }
      }
    })
    .catch((err) => {
      if (!controller.signal.aborted) {
        onEvent?.({ type: "error", data: { message: err.message } });
      }
    });

  return { abort: () => controller.abort() };
};
