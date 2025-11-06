import axios from "axios";

const baseURL = (import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api").replace(/\/+$/, "");

const client = axios.create({
  baseURL,
  timeout: 600000000000000
});

client.interceptors.request.use((config) => {
  const augmented = { ...config };
  augmented.headers = {
    "X-Requested-With": "XMLHttpRequest",
    ...(config.headers || {})
  };
  return augmented;
});

client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response) {
      const requestId = error.response.headers?.["x-request-id"];
      const payload = error.response.data || {};

      if (payload.error) {
        payload.error.requestId = payload.error.requestId || requestId;
      } else if (requestId) {
        payload.requestId = requestId;
      }

      console.error("API request failed", {
        url: error.config?.url,
        status: error.response.status,
        requestId,
        payload
      });

      return Promise.reject(payload);
    }

    console.error("Network error while calling API", {
      message: error.message,
      url: error.config?.url
    });

    return Promise.reject({
      error: {
        message: error.message || "Unexpected network error"
      }
    });
  }
);

export default client;
