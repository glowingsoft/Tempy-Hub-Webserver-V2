(function () {
  var STORAGE_KEY = "tempy_swagger_bearer";

  function readTokenFromPayload(payload) {
    if (!payload || typeof payload !== "object") return "";
    if (payload.data && payload.data.token) return String(payload.data.token);
    if (payload.token) return String(payload.token);
    return "";
  }

  function applyBearer(token) {
    if (!token) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, token);
    } catch (err) {}
    var ui = window.ui;
    if (ui && typeof ui.preauthorizeApiKey === "function") {
      ui.preauthorizeApiKey("bearerAuth", token);
    }
  }

  function captureLoginResponse(url, res) {
    if (!res || !res.ok) return;
    if (!url || url.indexOf("/auth/login") === -1) return;
    res
      .clone()
      .json()
      .then(function (payload) {
        applyBearer(readTokenFromPayload(payload));
      })
      .catch(function () {});
  }

  var originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = function () {
      var input = arguments[0];
      var url =
        typeof input === "string"
          ? input
          : input && input.url
            ? input.url
            : "";
      return originalFetch.apply(this, arguments).then(function (res) {
        captureLoginResponse(url, res);
        return res;
      });
    };
  }

  window.addEventListener("load", function () {
    setTimeout(function () {
      try {
        applyBearer(window.localStorage.getItem(STORAGE_KEY) || "");
      } catch (err) {}
    }, 400);
  });
})();
