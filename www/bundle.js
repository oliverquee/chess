var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// node_modules/@capacitor/core/dist/index.js
var ExceptionCode, CapacitorException, getPlatformId, createCapacitor, initCapacitorGlobal, Capacitor, registerPlugin, WebPlugin, encode, decode, CapacitorCookiesPluginWeb, CapacitorCookies, readBlobAsBase64, normalizeHttpHeaders, buildUrlParams, buildRequestInit, CapacitorHttpPluginWeb, CapacitorHttp, SystemBarsStyle, SystemBarType, SystemBarsPluginWeb, SystemBars;
var init_dist = __esm({
  "node_modules/@capacitor/core/dist/index.js"() {
    (function(ExceptionCode2) {
      ExceptionCode2["Unimplemented"] = "UNIMPLEMENTED";
      ExceptionCode2["Unavailable"] = "UNAVAILABLE";
    })(ExceptionCode || (ExceptionCode = {}));
    CapacitorException = class extends Error {
      constructor(message, code, data) {
        super(message);
        this.message = message;
        this.code = code;
        this.data = data;
      }
    };
    getPlatformId = (win) => {
      var _a, _b;
      if (win === null || win === void 0 ? void 0 : win.androidBridge) {
        return "android";
      } else if ((_b = (_a = win === null || win === void 0 ? void 0 : win.webkit) === null || _a === void 0 ? void 0 : _a.messageHandlers) === null || _b === void 0 ? void 0 : _b.bridge) {
        return "ios";
      } else {
        return "web";
      }
    };
    createCapacitor = (win) => {
      const capCustomPlatform = win.CapacitorCustomPlatform || null;
      const cap = win.Capacitor || {};
      const Plugins = cap.Plugins = cap.Plugins || {};
      const getPlatform = () => {
        return capCustomPlatform !== null ? capCustomPlatform.name : getPlatformId(win);
      };
      const isNativePlatform = () => getPlatform() !== "web";
      const isPluginAvailable = (pluginName) => {
        const plugin = registeredPlugins.get(pluginName);
        if (plugin === null || plugin === void 0 ? void 0 : plugin.platforms.has(getPlatform())) {
          return true;
        }
        if (getPluginHeader(pluginName)) {
          return true;
        }
        return false;
      };
      const getPluginHeader = (pluginName) => {
        var _a;
        return (_a = cap.PluginHeaders) === null || _a === void 0 ? void 0 : _a.find((h) => h.name === pluginName);
      };
      const handleError = (err) => win.console.error(err);
      const registeredPlugins = /* @__PURE__ */ new Map();
      const registerPlugin2 = (pluginName, jsImplementations = {}) => {
        const registeredPlugin = registeredPlugins.get(pluginName);
        if (registeredPlugin) {
          console.warn(`Capacitor plugin "${pluginName}" already registered. Cannot register plugins twice.`);
          return registeredPlugin.proxy;
        }
        const platform = getPlatform();
        const pluginHeader = getPluginHeader(pluginName);
        let jsImplementation;
        const loadPluginImplementation = async () => {
          if (!jsImplementation && platform in jsImplementations) {
            jsImplementation = typeof jsImplementations[platform] === "function" ? jsImplementation = await jsImplementations[platform]() : jsImplementation = jsImplementations[platform];
          } else if (capCustomPlatform !== null && !jsImplementation && "web" in jsImplementations) {
            jsImplementation = typeof jsImplementations["web"] === "function" ? jsImplementation = await jsImplementations["web"]() : jsImplementation = jsImplementations["web"];
          }
          return jsImplementation;
        };
        const createPluginMethod = (impl, prop) => {
          var _a, _b;
          if (pluginHeader) {
            const methodHeader = pluginHeader === null || pluginHeader === void 0 ? void 0 : pluginHeader.methods.find((m) => prop === m.name);
            if (methodHeader) {
              if (methodHeader.rtype === "promise") {
                return (options) => cap.nativePromise(pluginName, prop.toString(), options);
              } else {
                return (options, callback) => cap.nativeCallback(pluginName, prop.toString(), options, callback);
              }
            } else if (impl) {
              return (_a = impl[prop]) === null || _a === void 0 ? void 0 : _a.bind(impl);
            }
          } else if (impl) {
            return (_b = impl[prop]) === null || _b === void 0 ? void 0 : _b.bind(impl);
          } else {
            throw new CapacitorException(`"${pluginName}" plugin is not implemented on ${platform}`, ExceptionCode.Unimplemented);
          }
        };
        const createPluginMethodWrapper = (prop) => {
          let remove;
          const wrapper = (...args) => {
            const p = loadPluginImplementation().then((impl) => {
              const fn = createPluginMethod(impl, prop);
              if (fn) {
                const p2 = fn(...args);
                remove = p2 === null || p2 === void 0 ? void 0 : p2.remove;
                return p2;
              } else {
                throw new CapacitorException(`"${pluginName}.${prop}()" is not implemented on ${platform}`, ExceptionCode.Unimplemented);
              }
            });
            if (prop === "addListener") {
              p.remove = async () => remove();
            }
            return p;
          };
          wrapper.toString = () => `${prop.toString()}() { [capacitor code] }`;
          Object.defineProperty(wrapper, "name", {
            value: prop,
            writable: false,
            configurable: false
          });
          return wrapper;
        };
        const addListener = createPluginMethodWrapper("addListener");
        const removeListener = createPluginMethodWrapper("removeListener");
        const addListenerNative = (eventName, callback) => {
          const call = addListener({ eventName }, callback);
          const remove = async () => {
            const callbackId = await call;
            removeListener({
              eventName,
              callbackId
            }, callback);
          };
          const p = new Promise((resolve) => call.then(() => resolve({ remove })));
          p.remove = async () => {
            console.warn(`Using addListener() without 'await' is deprecated.`);
            await remove();
          };
          return p;
        };
        const proxy = new Proxy({}, {
          get(_, prop) {
            switch (prop) {
              // https://github.com/facebook/react/issues/20030
              case "$$typeof":
                return void 0;
              case "toJSON":
                return () => ({});
              case "addListener":
                return pluginHeader ? addListenerNative : addListener;
              case "removeListener":
                return removeListener;
              default:
                return createPluginMethodWrapper(prop);
            }
          }
        });
        Plugins[pluginName] = proxy;
        registeredPlugins.set(pluginName, {
          name: pluginName,
          proxy,
          platforms: /* @__PURE__ */ new Set([...Object.keys(jsImplementations), ...pluginHeader ? [platform] : []])
        });
        return proxy;
      };
      if (!cap.convertFileSrc) {
        cap.convertFileSrc = (filePath) => filePath;
      }
      cap.getPlatform = getPlatform;
      cap.handleError = handleError;
      cap.isNativePlatform = isNativePlatform;
      cap.isPluginAvailable = isPluginAvailable;
      cap.registerPlugin = registerPlugin2;
      cap.Exception = CapacitorException;
      cap.DEBUG = !!cap.DEBUG;
      cap.isLoggingEnabled = !!cap.isLoggingEnabled;
      return cap;
    };
    initCapacitorGlobal = (win) => win.Capacitor = createCapacitor(win);
    Capacitor = /* @__PURE__ */ initCapacitorGlobal(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : {});
    registerPlugin = Capacitor.registerPlugin;
    WebPlugin = class {
      constructor() {
        this.listeners = {};
        this.retainedEventArguments = {};
        this.windowListeners = {};
      }
      addListener(eventName, listenerFunc) {
        let firstListener = false;
        const listeners = this.listeners[eventName];
        if (!listeners) {
          this.listeners[eventName] = [];
          firstListener = true;
        }
        this.listeners[eventName].push(listenerFunc);
        const windowListener = this.windowListeners[eventName];
        if (windowListener && !windowListener.registered) {
          this.addWindowListener(windowListener);
        }
        if (firstListener) {
          this.sendRetainedArgumentsForEvent(eventName);
        }
        const remove = async () => this.removeListener(eventName, listenerFunc);
        const p = Promise.resolve({ remove });
        return p;
      }
      async removeAllListeners() {
        this.listeners = {};
        for (const listener in this.windowListeners) {
          this.removeWindowListener(this.windowListeners[listener]);
        }
        this.windowListeners = {};
      }
      notifyListeners(eventName, data, retainUntilConsumed) {
        const listeners = this.listeners[eventName];
        if (!listeners) {
          if (retainUntilConsumed) {
            let args = this.retainedEventArguments[eventName];
            if (!args) {
              args = [];
            }
            args.push(data);
            this.retainedEventArguments[eventName] = args;
          }
          return;
        }
        listeners.forEach((listener) => listener(data));
      }
      hasListeners(eventName) {
        var _a;
        return !!((_a = this.listeners[eventName]) === null || _a === void 0 ? void 0 : _a.length);
      }
      registerWindowListener(windowEventName, pluginEventName) {
        this.windowListeners[pluginEventName] = {
          registered: false,
          windowEventName,
          pluginEventName,
          handler: (event) => {
            this.notifyListeners(pluginEventName, event);
          }
        };
      }
      unimplemented(msg = "not implemented") {
        return new Capacitor.Exception(msg, ExceptionCode.Unimplemented);
      }
      unavailable(msg = "not available") {
        return new Capacitor.Exception(msg, ExceptionCode.Unavailable);
      }
      async removeListener(eventName, listenerFunc) {
        const listeners = this.listeners[eventName];
        if (!listeners) {
          return;
        }
        const index = listeners.indexOf(listenerFunc);
        this.listeners[eventName].splice(index, 1);
        if (!this.listeners[eventName].length) {
          this.removeWindowListener(this.windowListeners[eventName]);
        }
      }
      addWindowListener(handle) {
        window.addEventListener(handle.windowEventName, handle.handler);
        handle.registered = true;
      }
      removeWindowListener(handle) {
        if (!handle) {
          return;
        }
        window.removeEventListener(handle.windowEventName, handle.handler);
        handle.registered = false;
      }
      sendRetainedArgumentsForEvent(eventName) {
        const args = this.retainedEventArguments[eventName];
        if (!args) {
          return;
        }
        delete this.retainedEventArguments[eventName];
        args.forEach((arg) => {
          this.notifyListeners(eventName, arg);
        });
      }
    };
    encode = (str) => encodeURIComponent(str).replace(/%(2[346B]|5E|60|7C)/g, decodeURIComponent).replace(/[()]/g, escape);
    decode = (str) => str.replace(/(%[\dA-F]{2})+/gi, decodeURIComponent);
    CapacitorCookiesPluginWeb = class extends WebPlugin {
      async getCookies() {
        const cookies = document.cookie;
        const cookieMap = {};
        cookies.split(";").forEach((cookie) => {
          if (cookie.length <= 0)
            return;
          let [key, value] = cookie.replace(/=/, "CAP_COOKIE").split("CAP_COOKIE");
          key = decode(key).trim();
          value = decode(value).trim();
          cookieMap[key] = value;
        });
        return cookieMap;
      }
      async setCookie(options) {
        try {
          const encodedKey = encode(options.key);
          const encodedValue = encode(options.value);
          const expires = options.expires ? `; expires=${options.expires.replace("expires=", "")}` : "";
          const path = (options.path || "/").replace("path=", "");
          const domain = options.url != null && options.url.length > 0 ? `domain=${options.url}` : "";
          document.cookie = `${encodedKey}=${encodedValue || ""}${expires}; path=${path}; ${domain};`;
        } catch (error) {
          return Promise.reject(error);
        }
      }
      async deleteCookie(options) {
        try {
          document.cookie = `${options.key}=; Max-Age=0`;
        } catch (error) {
          return Promise.reject(error);
        }
      }
      async clearCookies() {
        try {
          const cookies = document.cookie.split(";") || [];
          for (const cookie of cookies) {
            document.cookie = cookie.replace(/^ +/, "").replace(/=.*/, `=;expires=${(/* @__PURE__ */ new Date()).toUTCString()};path=/`);
          }
        } catch (error) {
          return Promise.reject(error);
        }
      }
      async clearAllCookies() {
        try {
          await this.clearCookies();
        } catch (error) {
          return Promise.reject(error);
        }
      }
    };
    CapacitorCookies = registerPlugin("CapacitorCookies", {
      web: () => new CapacitorCookiesPluginWeb()
    });
    readBlobAsBase64 = async (blob) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64String = reader.result;
        resolve(base64String.indexOf(",") >= 0 ? base64String.split(",")[1] : base64String);
      };
      reader.onerror = (error) => reject(error);
      reader.readAsDataURL(blob);
    });
    normalizeHttpHeaders = (headers = {}) => {
      const originalKeys = Object.keys(headers);
      const loweredKeys = Object.keys(headers).map((k) => k.toLocaleLowerCase());
      const normalized = loweredKeys.reduce((acc, key, index) => {
        acc[key] = headers[originalKeys[index]];
        return acc;
      }, {});
      return normalized;
    };
    buildUrlParams = (params, shouldEncode = true) => {
      if (!params)
        return null;
      const output = Object.entries(params).reduce((accumulator, entry) => {
        const [key, value] = entry;
        let encodedValue;
        let item;
        if (Array.isArray(value)) {
          item = "";
          value.forEach((str) => {
            encodedValue = shouldEncode ? encodeURIComponent(str) : str;
            item += `${key}=${encodedValue}&`;
          });
          item.slice(0, -1);
        } else {
          encodedValue = shouldEncode ? encodeURIComponent(value) : value;
          item = `${key}=${encodedValue}`;
        }
        return `${accumulator}&${item}`;
      }, "");
      return output.substr(1);
    };
    buildRequestInit = (options, extra = {}) => {
      const output = Object.assign({ method: options.method || "GET", headers: options.headers }, extra);
      const headers = normalizeHttpHeaders(options.headers);
      const type = headers["content-type"] || "";
      if (typeof options.data === "string") {
        output.body = options.data;
      } else if (type.includes("application/x-www-form-urlencoded")) {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(options.data || {})) {
          params.set(key, value);
        }
        output.body = params.toString();
      } else if (type.includes("multipart/form-data") || options.data instanceof FormData) {
        const form = new FormData();
        if (options.data instanceof FormData) {
          options.data.forEach((value, key) => {
            form.append(key, value);
          });
        } else {
          for (const key of Object.keys(options.data)) {
            form.append(key, options.data[key]);
          }
        }
        output.body = form;
        const headers2 = new Headers(output.headers);
        headers2.delete("content-type");
        output.headers = headers2;
      } else if (type.includes("application/json") || typeof options.data === "object") {
        output.body = JSON.stringify(options.data);
      }
      return output;
    };
    CapacitorHttpPluginWeb = class extends WebPlugin {
      /**
       * Perform an Http request given a set of options
       * @param options Options to build the HTTP request
       */
      async request(options) {
        const requestInit = buildRequestInit(options, options.webFetchExtra);
        const urlParams = buildUrlParams(options.params, options.shouldEncodeUrlParams);
        const url = urlParams ? `${options.url}?${urlParams}` : options.url;
        const response = await fetch(url, requestInit);
        const contentType = response.headers.get("content-type") || "";
        let { responseType = "text" } = response.ok ? options : {};
        if (contentType.includes("application/json")) {
          responseType = "json";
        }
        let data;
        let blob;
        switch (responseType) {
          case "arraybuffer":
          case "blob":
            blob = await response.blob();
            data = await readBlobAsBase64(blob);
            break;
          case "json":
            data = await response.json();
            break;
          case "document":
          case "text":
          default:
            data = await response.text();
        }
        const headers = {};
        response.headers.forEach((value, key) => {
          headers[key] = value;
        });
        return {
          data,
          headers,
          status: response.status,
          url: response.url
        };
      }
      /**
       * Perform an Http GET request given a set of options
       * @param options Options to build the HTTP request
       */
      async get(options) {
        return this.request(Object.assign(Object.assign({}, options), { method: "GET" }));
      }
      /**
       * Perform an Http POST request given a set of options
       * @param options Options to build the HTTP request
       */
      async post(options) {
        return this.request(Object.assign(Object.assign({}, options), { method: "POST" }));
      }
      /**
       * Perform an Http PUT request given a set of options
       * @param options Options to build the HTTP request
       */
      async put(options) {
        return this.request(Object.assign(Object.assign({}, options), { method: "PUT" }));
      }
      /**
       * Perform an Http PATCH request given a set of options
       * @param options Options to build the HTTP request
       */
      async patch(options) {
        return this.request(Object.assign(Object.assign({}, options), { method: "PATCH" }));
      }
      /**
       * Perform an Http DELETE request given a set of options
       * @param options Options to build the HTTP request
       */
      async delete(options) {
        return this.request(Object.assign(Object.assign({}, options), { method: "DELETE" }));
      }
    };
    CapacitorHttp = registerPlugin("CapacitorHttp", {
      web: () => new CapacitorHttpPluginWeb()
    });
    (function(SystemBarsStyle2) {
      SystemBarsStyle2["Dark"] = "DARK";
      SystemBarsStyle2["Light"] = "LIGHT";
      SystemBarsStyle2["Default"] = "DEFAULT";
    })(SystemBarsStyle || (SystemBarsStyle = {}));
    (function(SystemBarType2) {
      SystemBarType2["StatusBar"] = "StatusBar";
      SystemBarType2["NavigationBar"] = "NavigationBar";
    })(SystemBarType || (SystemBarType = {}));
    SystemBarsPluginWeb = class extends WebPlugin {
      async setStyle() {
        this.unavailable("not available for web");
      }
      async setAnimation() {
        this.unavailable("not available for web");
      }
      async show() {
        this.unavailable("not available for web");
      }
      async hide() {
        this.unavailable("not available for web");
      }
    };
    SystemBars = registerPlugin("SystemBars", {
      web: () => new SystemBarsPluginWeb()
    });
  }
});

// node_modules/@capgo/capacitor-inappbrowser/dist/esm/web.js
var web_exports = {};
__export(web_exports, {
  InAppBrowserWeb: () => InAppBrowserWeb
});
var InAppBrowserWeb;
var init_web = __esm({
  "node_modules/@capgo/capacitor-inappbrowser/dist/esm/web.js"() {
    init_dist();
    InAppBrowserWeb = class extends WebPlugin {
      clearAllCookies() {
        console.log("clearAllCookies");
        return Promise.resolve();
      }
      clearCache() {
        console.log("clearCache");
        return Promise.resolve();
      }
      clearAllBrowsingData() {
        console.log("clearAllBrowsingData");
        return Promise.resolve();
      }
      async open(options) {
        console.log("open", options);
        return options;
      }
      async clearCookies(options) {
        console.log("cleanCookies", options);
        return;
      }
      async getCookies(options) {
        return options;
      }
      async openWebView(options) {
        console.log("openWebView", options);
        return options;
      }
      async executeScript({ code }) {
        console.log("code", code);
        return code;
      }
      async close(options) {
        console.log("close", options);
        return;
      }
      async hide(options) {
        console.log("hide", options);
        return;
      }
      async show(options) {
        console.log("show", options);
        return;
      }
      async sendToBack(options) {
        console.log("sendToBack not supported on web", options);
        return;
      }
      async bringToFront(options) {
        console.log("bringToFront not supported on web", options);
        return;
      }
      async dispatchInputEvent(options) {
        console.log("dispatchInputEvent not supported on web", options);
        return;
      }
      async setUrl(options) {
        console.log("setUrl", options.url);
        return;
      }
      async reload(options) {
        console.log("reload", options);
        return;
      }
      async postMessage(options) {
        console.log("postMessage", options);
        return options;
      }
      async takeScreenshot(options) {
        console.log("takeScreenshot not supported on web", options);
        throw this.unimplemented("Screenshots are not supported on web.");
      }
      async goBack() {
        console.log("goBack");
        return;
      }
      async getPluginVersion() {
        return { version: "web" };
      }
      async updateDimensions(options) {
        console.log("updateDimensions", options);
        return;
      }
      async handleProxyRequest(options) {
        console.log("handleProxyRequest not supported on web", options);
        return;
      }
      async setEnabledSafeTopMargin(options) {
        console.log("setEnabledSafeTopMargin not supported on web", options);
        return;
      }
      async setEnabledSafeBottomMargin(options) {
        console.log("setEnabledSafeBottomMargin not supported on web", options);
        return;
      }
      async openSecureWindow(options) {
        const w = 600;
        const h = 550;
        const settings2 = [
          ["width", w],
          ["height", h],
          ["left", screen.width / 2 - w / 2],
          ["top", screen.height / 2 - h / 2]
        ].map((x) => x.join("=")).join(",");
        const popup = window.open(options.authEndpoint, "Authorization", settings2);
        if (!popup) {
          throw new Error("Failed to open secure window");
        }
        if (typeof popup.focus === "function") {
          popup.focus();
        }
        return new Promise((resolve, reject) => {
          const bc = new BroadcastChannel(options.broadcastChannelName || "oauth-channel");
          bc.addEventListener("message", (event) => {
            if (event.data.startsWith(options.redirectUri)) {
              bc.close();
              resolve({ redirectedUri: event.data });
            } else {
              bc.close();
              reject(new Error("Redirect URI does not match, expected " + options.redirectUri + " but got " + event.data));
            }
          });
          setTimeout(() => {
            bc.close();
            reject(new Error("The sign-in flow timed out"));
          }, 5 * 6e4);
        });
      }
    };
  }
});

// node_modules/@capacitor-community/sqlite/dist/esm/web.js
var web_exports2 = {};
__export(web_exports2, {
  CapacitorSQLiteWeb: () => CapacitorSQLiteWeb
});
var CapacitorSQLiteWeb;
var init_web2 = __esm({
  "node_modules/@capacitor-community/sqlite/dist/esm/web.js"() {
    init_dist();
    CapacitorSQLiteWeb = class extends WebPlugin {
      constructor() {
        super(...arguments);
        this.jeepSqliteElement = null;
        this.isWebStoreOpen = false;
      }
      async initWebStore() {
        await customElements.whenDefined("jeep-sqlite");
        this.jeepSqliteElement = document.querySelector("jeep-sqlite");
        this.ensureJeepSqliteIsAvailable();
        this.jeepSqliteElement.addEventListener("jeepSqliteImportProgress", (event) => {
          this.notifyListeners("sqliteImportProgressEvent", event.detail);
        });
        this.jeepSqliteElement.addEventListener("jeepSqliteExportProgress", (event) => {
          this.notifyListeners("sqliteExportProgressEvent", event.detail);
        });
        this.jeepSqliteElement.addEventListener("jeepSqliteHTTPRequestEnded", (event) => {
          this.notifyListeners("sqliteHTTPRequestEndedEvent", event.detail);
        });
        this.jeepSqliteElement.addEventListener("jeepSqlitePickDatabaseEnded", (event) => {
          this.notifyListeners("sqlitePickDatabaseEndedEvent", event.detail);
        });
        this.jeepSqliteElement.addEventListener("jeepSqliteSaveDatabaseToDisk", (event) => {
          this.notifyListeners("sqliteSaveDatabaseToDiskEvent", event.detail);
        });
        if (!this.isWebStoreOpen) {
          this.isWebStoreOpen = await this.jeepSqliteElement.isStoreOpen();
        }
        return;
      }
      async saveToStore(options) {
        this.ensureJeepSqliteIsAvailable();
        this.ensureWebstoreIsOpen();
        try {
          await this.jeepSqliteElement.saveToStore(options);
          return;
        } catch (err) {
          throw new Error(`${err}`);
        }
      }
      async getFromLocalDiskToStore(options) {
        this.ensureJeepSqliteIsAvailable();
        this.ensureWebstoreIsOpen();
        try {
          await this.jeepSqliteElement.getFromLocalDiskToStore(options);
          return;
        } catch (err) {
          throw new Error(`${err}`);
        }
      }
      async saveToLocalDisk(options) {
        this.ensureJeepSqliteIsAvailable();
        this.ensureWebstoreIsOpen();
        try {
          await this.jeepSqliteElement.saveToLocalDisk(options);
          return;
        } catch (err) {
          throw new Error(`${err}`);
        }
      }
      async echo(options) {
        this.ensureJeepSqliteIsAvailable();
        const echoResult = await this.jeepSqliteElement.echo(options);
        return echoResult;
      }
      async createConnection(options) {
        this.ensureJeepSqliteIsAvailable();
        this.ensureWebstoreIsOpen();
        try {
          await this.jeepSqliteElement.createConnection(options);
          return;
        } catch (err) {
          throw new Error(`${err}`);
        }
      }
      async open(options) {
        this.ensureJeepSqliteIsAvailable();
        this.ensureWebstoreIsOpen();
        try {
          await this.jeepSqliteElement.open(options);
          return;
        } catch (err) {
          throw new Error(`${err}`);
        }
      }
      async closeConnection(options) {
        this.ensureJeepSqliteIsAvailable();
        this.ensureWebstoreIsOpen();
        try {
          await this.jeepSqliteElement.closeConnection(options);
          return;
        } catch (err) {
          throw new Error(`${err}`);
        }
      }
      async getVersion(options) {
        this.ensureJeepSqliteIsAvailable();
        this.ensureWebstoreIsOpen();
        try {
          const versionResult = await this.jeepSqliteElement.getVersion(options);
          return versionResult;
        } catch (err) {
          throw new Error(`${err}`);
        }
      }
      async checkConnectionsConsistency(options) {
        this.ensureJeepSqliteIsAvailable();
        try {
          const consistencyResult = await this.jeepSqliteElement.checkConnectionsConsistency(options);
          return consistencyResult;
        } catch (err) {
          throw new Error(`${err}`);
        }
      }
      async close(options) {
        this.ensureJeepSqliteIsAvailable();
        this.ensureWebstoreIsOpen();
        try {
          await this.jeepSqliteElement.close(options);
          return;
        } catch (err) {
          throw new Error(`${err}`);
        }
      }
      async beginTransaction(options) {
        this.ensureJeepSqliteIsAvailable();
        this.ensureWebstoreIsOpen();
        try {
          const changes = await this.jeepSqliteElement.beginTransaction(options);
          return changes;
        } catch (err) {
          throw new Error(`${err}`);
        }
      }
      async commitTransaction(options) {
        this.ensureJeepSqliteIsAvailable();
        this.ensureWebstoreIsOpen();
        try {
          const changes = await this.jeepSqliteElement.commitTransaction(options);
          return changes;
        } catch (err) {
          throw new Error(`${err}`);
        }
      }
      async rollbackTransaction(options) {
        this.ensureJeepSqliteIsAvailable();
        this.ensureWebstoreIsOpen();
        try {
          const changes = await this.jeepSqliteElement.rollbackTransaction(options);
          return changes;
        } catch (err) {
          throw new Error(`${err}`);
        }
      }
      async isTransactionActive(options) {
        this.ensureJeepSqliteIsAvailable();
        this.ensureWebstoreIsOpen();
        try {
          const result = await this.jeepSqliteElement.isTransactionActive(options);
          return result;
        } catch (err) {
          throw new Error(`${err}`);
        }
      }
      async getTableList(options) {
        this.ensureJeepSqliteIsAvailable();
        this.ensureWebstoreIsOpen();
        try {
          const tableListResult = await this.jeepSqliteElement.getTableList(options);
          return tableListResult;
        } catch (err) {
          throw new Error(`${err}`);
        }
      }
      async execute(options) {
        this.ensureJeepSqliteIsAvailable();
        this.ensureWebstoreIsOpen();
        try {
          const executeResult = await this.jeepSqliteElement.execute(options);
          return executeResult;
        } catch (err) {
          throw new Error(`${err}`);
        }
      }
      async executeSet(options) {
        this.ensureJeepSqliteIsAvailable();
        this.ensureWebstoreIsOpen();
        try {
          const executeResult = await this.jeepSqliteElement.executeSet(options);
          return executeResult;
        } catch (err) {
          throw new Error(`${err}`);
        }
      }
      async run(options) {
        this.ensureJeepSqliteIsAvailable();
        this.ensureWebstoreIsOpen();
        try {
          const runResult = await this.jeepSqliteElement.run(options);
          return runResult;
        } catch (err) {
          throw new Error(`${err}`);
        }
      }
      async query(options) {
        this.ensureJeepSqliteIsAvailable();
        this.ensureWebstoreIsOpen();
        try {
          const queryResult = await this.jeepSqliteElement.query(options);
          return queryResult;
        } catch (err) {
          throw new Error(`${err}`);
        }
      }
      async isDBExists(options) {
        this.ensureJeepSqliteIsAvailable();
        this.ensureWebstoreIsOpen();
        try {
          const dbExistsResult = await this.jeepSqliteElement.isDBExists(options);
          return dbExistsResult;
        } catch (err) {
          throw new Error(`${err}`);
        }
      }
      async isDBOpen(options) {
        this.ensureJeepSqliteIsAvailable();
        this.ensureWebstoreIsOpen();
        try {
          const isDBOpenResult = await this.jeepSqliteElement.isDBOpen(options);
          return isDBOpenResult;
        } catch (err) {
          throw new Error(`${err}`);
        }
      }
      async isDatabase(options) {
        this.ensureJeepSqliteIsAvailable();
        this.ensureWebstoreIsOpen();
        try {
          const isDatabaseResult = await this.jeepSqliteElement.isDatabase(options);
          return isDatabaseResult;
        } catch (err) {
          throw new Error(`${err}`);
        }
      }
      async isTableExists(options) {
        this.ensureJeepSqliteIsAvailable();
        this.ensureWebstoreIsOpen();
        try {
          const tableExistsResult = await this.jeepSqliteElement.isTableExists(options);
          return tableExistsResult;
        } catch (err) {
          throw new Error(`${err}`);
        }
      }
      async deleteDatabase(options) {
        this.ensureJeepSqliteIsAvailable();
        this.ensureWebstoreIsOpen();
        try {
          await this.jeepSqliteElement.deleteDatabase(options);
          return;
        } catch (err) {
          throw new Error(`${err}`);
        }
      }
      async isJsonValid(options) {
        this.ensureJeepSqliteIsAvailable();
        this.ensureWebstoreIsOpen();
        try {
          const isJsonValidResult = await this.jeepSqliteElement.isJsonValid(options);
          return isJsonValidResult;
        } catch (err) {
          throw new Error(`${err}`);
        }
      }
      async importFromJson(options) {
        this.ensureJeepSqliteIsAvailable();
        this.ensureWebstoreIsOpen();
        try {
          const importFromJsonResult = await this.jeepSqliteElement.importFromJson(options);
          return importFromJsonResult;
        } catch (err) {
          throw new Error(`${err}`);
        }
      }
      async exportToJson(options) {
        this.ensureJeepSqliteIsAvailable();
        this.ensureWebstoreIsOpen();
        try {
          const exportToJsonResult = await this.jeepSqliteElement.exportToJson(options);
          return exportToJsonResult;
        } catch (err) {
          throw new Error(`${err}`);
        }
      }
      async createSyncTable(options) {
        this.ensureJeepSqliteIsAvailable();
        this.ensureWebstoreIsOpen();
        try {
          const createSyncTableResult = await this.jeepSqliteElement.createSyncTable(options);
          return createSyncTableResult;
        } catch (err) {
          throw new Error(`${err}`);
        }
      }
      async setSyncDate(options) {
        this.ensureJeepSqliteIsAvailable();
        this.ensureWebstoreIsOpen();
        try {
          await this.jeepSqliteElement.setSyncDate(options);
          return;
        } catch (err) {
          throw new Error(`${err}`);
        }
      }
      async getSyncDate(options) {
        this.ensureJeepSqliteIsAvailable();
        this.ensureWebstoreIsOpen();
        try {
          const getSyncDateResult = await this.jeepSqliteElement.getSyncDate(options);
          return getSyncDateResult;
        } catch (err) {
          throw new Error(`${err}`);
        }
      }
      async deleteExportedRows(options) {
        this.ensureJeepSqliteIsAvailable();
        this.ensureWebstoreIsOpen();
        try {
          await this.jeepSqliteElement.deleteExportedRows(options);
          return;
        } catch (err) {
          throw new Error(`${err}`);
        }
      }
      async addUpgradeStatement(options) {
        this.ensureJeepSqliteIsAvailable();
        this.ensureWebstoreIsOpen();
        try {
          await this.jeepSqliteElement.addUpgradeStatement(options);
          return;
        } catch (err) {
          throw new Error(`${err}`);
        }
      }
      async copyFromAssets(options) {
        this.ensureJeepSqliteIsAvailable();
        this.ensureWebstoreIsOpen();
        try {
          await this.jeepSqliteElement.copyFromAssets(options);
          return;
        } catch (err) {
          throw new Error(`${err}`);
        }
      }
      async getFromHTTPRequest(options) {
        this.ensureJeepSqliteIsAvailable();
        this.ensureWebstoreIsOpen();
        try {
          await this.jeepSqliteElement.getFromHTTPRequest(options);
          return;
        } catch (err) {
          throw new Error(`${err}`);
        }
      }
      async getDatabaseList() {
        this.ensureJeepSqliteIsAvailable();
        this.ensureWebstoreIsOpen();
        try {
          const databaseListResult = await this.jeepSqliteElement.getDatabaseList();
          return databaseListResult;
        } catch (err) {
          throw new Error(`${err}`);
        }
      }
      /**
       * Checks if the `jeep-sqlite` element is present in the DOM.
       * If it's not in the DOM, this method throws an Error.
       *
       * Attention: This will always fail, if the `intWebStore()` method wasn't called before.
       */
      ensureJeepSqliteIsAvailable() {
        if (this.jeepSqliteElement === null) {
          throw new Error(`The jeep-sqlite element is not present in the DOM! Please check the @capacitor-community/sqlite documentation for instructions regarding the web platform.`);
        }
      }
      ensureWebstoreIsOpen() {
        if (!this.isWebStoreOpen) {
          throw new Error('WebStore is not open yet. You have to call "initWebStore()" first.');
        }
      }
      ////////////////////////////////////
      ////// UNIMPLEMENTED METHODS
      ////////////////////////////////////
      async getUrl() {
        throw this.unimplemented("Not implemented on web.");
      }
      async getMigratableDbList(options) {
        console.log("getMigratableDbList", options);
        throw this.unimplemented("Not implemented on web.");
      }
      async addSQLiteSuffix(options) {
        console.log("addSQLiteSuffix", options);
        throw this.unimplemented("Not implemented on web.");
      }
      async deleteOldDatabases(options) {
        console.log("deleteOldDatabases", options);
        throw this.unimplemented("Not implemented on web.");
      }
      async moveDatabasesAndAddSuffix(options) {
        console.log("moveDatabasesAndAddSuffix", options);
        throw this.unimplemented("Not implemented on web.");
      }
      async isSecretStored() {
        throw this.unimplemented("Not implemented on web.");
      }
      async setEncryptionSecret(options) {
        console.log("setEncryptionSecret", options);
        throw this.unimplemented("Not implemented on web.");
      }
      async changeEncryptionSecret(options) {
        console.log("changeEncryptionSecret", options);
        throw this.unimplemented("Not implemented on web.");
      }
      async clearEncryptionSecret() {
        console.log("clearEncryptionSecret");
        throw this.unimplemented("Not implemented on web.");
      }
      async checkEncryptionSecret(options) {
        console.log("checkEncryptionPassPhrase", options);
        throw this.unimplemented("Not implemented on web.");
      }
      async getNCDatabasePath(options) {
        console.log("getNCDatabasePath", options);
        throw this.unimplemented("Not implemented on web.");
      }
      async createNCConnection(options) {
        console.log("createNCConnection", options);
        throw this.unimplemented("Not implemented on web.");
      }
      async closeNCConnection(options) {
        console.log("closeNCConnection", options);
        throw this.unimplemented("Not implemented on web.");
      }
      async isNCDatabase(options) {
        console.log("isNCDatabase", options);
        throw this.unimplemented("Not implemented on web.");
      }
      async isDatabaseEncrypted(options) {
        console.log("isDatabaseEncrypted", options);
        throw this.unimplemented("Not implemented on web.");
      }
      async isInConfigEncryption() {
        throw this.unimplemented("Not implemented on web.");
      }
      async isInConfigBiometricAuth() {
        throw this.unimplemented("Not implemented on web.");
      }
      async loadExtension(options) {
        console.log("loadExtension", options);
        throw this.unimplemented("Not implemented on web.");
      }
      async enableLoadExtension(options) {
        console.log("enableLoadExtension", options);
        throw this.unimplemented("Not implemented on web.");
      }
    };
  }
});

// node_modules/chess.js/dist/esm/chess.js
function rootNode(comment) {
  return comment !== null ? { comment, variations: [] } : { variations: [] };
}
function node(move, suffix, nag, comment, variations) {
  const node2 = { move, variations };
  if (suffix) {
    node2.suffix = suffix;
  }
  if (nag) {
    node2.nag = nag;
  }
  if (comment !== null) {
    node2.comment = comment;
  }
  return node2;
}
function lineToTree(...nodes) {
  const [root, ...rest] = nodes;
  let parent = root;
  for (const child of rest) {
    if (child !== null) {
      parent.variations = [child, ...child.variations];
      child.variations = [];
      parent = child;
    }
  }
  return root;
}
function pgn(headers, game) {
  if (game.marker && game.marker.comment) {
    let node2 = game.root;
    while (true) {
      const next = node2.variations[0];
      if (!next) {
        node2.comment = game.marker.comment;
        break;
      }
      node2 = next;
    }
  }
  return {
    headers,
    root: game.root,
    result: (game.marker && game.marker.result) ?? void 0
  };
}
function peg$subclass(child, parent) {
  function C() {
    this.constructor = child;
  }
  C.prototype = parent.prototype;
  child.prototype = new C();
}
function peg$SyntaxError(message, expected, found, location) {
  var self2 = Error.call(this, message);
  if (Object.setPrototypeOf) {
    Object.setPrototypeOf(self2, peg$SyntaxError.prototype);
  }
  self2.expected = expected;
  self2.found = found;
  self2.location = location;
  self2.name = "SyntaxError";
  return self2;
}
peg$subclass(peg$SyntaxError, Error);
function peg$padEnd(str, targetLength, padString) {
  padString = padString || " ";
  if (str.length > targetLength) {
    return str;
  }
  targetLength -= str.length;
  padString += padString.repeat(targetLength);
  return str + padString.slice(0, targetLength);
}
peg$SyntaxError.prototype.format = function(sources) {
  var str = "Error: " + this.message;
  if (this.location) {
    var src = null;
    var k;
    for (k = 0; k < sources.length; k++) {
      if (sources[k].source === this.location.source) {
        src = sources[k].text.split(/\r\n|\n|\r/g);
        break;
      }
    }
    var s = this.location.start;
    var offset_s = this.location.source && typeof this.location.source.offset === "function" ? this.location.source.offset(s) : s;
    var loc = this.location.source + ":" + offset_s.line + ":" + offset_s.column;
    if (src) {
      var e = this.location.end;
      var filler = peg$padEnd("", offset_s.line.toString().length, " ");
      var line = src[s.line - 1];
      var last = s.line === e.line ? e.column : line.length + 1;
      var hatLen = last - s.column || 1;
      str += "\n --> " + loc + "\n" + filler + " |\n" + offset_s.line + " | " + line + "\n" + filler + " | " + peg$padEnd("", s.column - 1, " ") + peg$padEnd("", hatLen, "^");
    } else {
      str += "\n at " + loc;
    }
  }
  return str;
};
peg$SyntaxError.buildMessage = function(expected, found) {
  var DESCRIBE_EXPECTATION_FNS = {
    literal: function(expectation) {
      return '"' + literalEscape(expectation.text) + '"';
    },
    class: function(expectation) {
      var escapedParts = expectation.parts.map(function(part) {
        return Array.isArray(part) ? classEscape(part[0]) + "-" + classEscape(part[1]) : classEscape(part);
      });
      return "[" + (expectation.inverted ? "^" : "") + escapedParts.join("") + "]";
    },
    any: function() {
      return "any character";
    },
    end: function() {
      return "end of input";
    },
    other: function(expectation) {
      return expectation.description;
    }
  };
  function hex2(ch) {
    return ch.charCodeAt(0).toString(16).toUpperCase();
  }
  function literalEscape(s) {
    return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\0/g, "\\0").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/[\x00-\x0F]/g, function(ch) {
      return "\\x0" + hex2(ch);
    }).replace(/[\x10-\x1F\x7F-\x9F]/g, function(ch) {
      return "\\x" + hex2(ch);
    });
  }
  function classEscape(s) {
    return s.replace(/\\/g, "\\\\").replace(/\]/g, "\\]").replace(/\^/g, "\\^").replace(/-/g, "\\-").replace(/\0/g, "\\0").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/[\x00-\x0F]/g, function(ch) {
      return "\\x0" + hex2(ch);
    }).replace(/[\x10-\x1F\x7F-\x9F]/g, function(ch) {
      return "\\x" + hex2(ch);
    });
  }
  function describeExpectation(expectation) {
    return DESCRIBE_EXPECTATION_FNS[expectation.type](expectation);
  }
  function describeExpected(expected2) {
    var descriptions = expected2.map(describeExpectation);
    var i, j;
    descriptions.sort();
    if (descriptions.length > 0) {
      for (i = 1, j = 1; i < descriptions.length; i++) {
        if (descriptions[i - 1] !== descriptions[i]) {
          descriptions[j] = descriptions[i];
          j++;
        }
      }
      descriptions.length = j;
    }
    switch (descriptions.length) {
      case 1:
        return descriptions[0];
      case 2:
        return descriptions[0] + " or " + descriptions[1];
      default:
        return descriptions.slice(0, -1).join(", ") + ", or " + descriptions[descriptions.length - 1];
    }
  }
  function describeFound(found2) {
    return found2 ? '"' + literalEscape(found2) + '"' : "end of input";
  }
  return "Expected " + describeExpected(expected) + " but " + describeFound(found) + " found.";
};
function peg$parse(input, options) {
  options = options !== void 0 ? options : {};
  var peg$FAILED = {};
  var peg$source = options.grammarSource;
  var peg$startRuleFunctions = { pgn: peg$parsepgn };
  var peg$startRuleFunction = peg$parsepgn;
  var peg$c0 = "[";
  var peg$c1 = '"';
  var peg$c2 = "]";
  var peg$c3 = ".";
  var peg$c4 = "O-O-O";
  var peg$c5 = "O-O";
  var peg$c6 = "0-0-0";
  var peg$c7 = "0-0";
  var peg$c8 = "$";
  var peg$c9 = "{";
  var peg$c10 = "}";
  var peg$c11 = ";";
  var peg$c12 = "(";
  var peg$c13 = ")";
  var peg$c14 = "1-0";
  var peg$c15 = "0-1";
  var peg$c16 = "1/2-1/2";
  var peg$c17 = "*";
  var peg$r0 = /^[a-zA-Z]/;
  var peg$r1 = /^[^"]/;
  var peg$r2 = /^[0-9]/;
  var peg$r3 = /^[.]/;
  var peg$r4 = /^[a-zA-Z1-8\-=]/;
  var peg$r5 = /^[+#]/;
  var peg$r6 = /^[!?]/;
  var peg$r7 = /^[^}]/;
  var peg$r8 = /^[^\r\n]/;
  var peg$r9 = /^[ \t\r\n]/;
  var peg$e0 = peg$otherExpectation("tag pair");
  var peg$e1 = peg$literalExpectation("[", false);
  var peg$e2 = peg$literalExpectation('"', false);
  var peg$e3 = peg$literalExpectation("]", false);
  var peg$e4 = peg$otherExpectation("tag name");
  var peg$e5 = peg$classExpectation([["a", "z"], ["A", "Z"]], false, false);
  var peg$e6 = peg$otherExpectation("tag value");
  var peg$e7 = peg$classExpectation(['"'], true, false);
  var peg$e8 = peg$otherExpectation("move number");
  var peg$e9 = peg$classExpectation([["0", "9"]], false, false);
  var peg$e10 = peg$literalExpectation(".", false);
  var peg$e11 = peg$classExpectation(["."], false, false);
  var peg$e12 = peg$otherExpectation("standard algebraic notation");
  var peg$e13 = peg$literalExpectation("O-O-O", false);
  var peg$e14 = peg$literalExpectation("O-O", false);
  var peg$e15 = peg$literalExpectation("0-0-0", false);
  var peg$e16 = peg$literalExpectation("0-0", false);
  var peg$e17 = peg$classExpectation([["a", "z"], ["A", "Z"], ["1", "8"], "-", "="], false, false);
  var peg$e18 = peg$classExpectation(["+", "#"], false, false);
  var peg$e19 = peg$otherExpectation("suffix annotation");
  var peg$e20 = peg$classExpectation(["!", "?"], false, false);
  var peg$e21 = peg$otherExpectation("NAG");
  var peg$e22 = peg$literalExpectation("$", false);
  var peg$e23 = peg$otherExpectation("brace comment");
  var peg$e24 = peg$literalExpectation("{", false);
  var peg$e25 = peg$classExpectation(["}"], true, false);
  var peg$e26 = peg$literalExpectation("}", false);
  var peg$e27 = peg$otherExpectation("rest of line comment");
  var peg$e28 = peg$literalExpectation(";", false);
  var peg$e29 = peg$classExpectation(["\r", "\n"], true, false);
  var peg$e30 = peg$otherExpectation("variation");
  var peg$e31 = peg$literalExpectation("(", false);
  var peg$e32 = peg$literalExpectation(")", false);
  var peg$e33 = peg$otherExpectation("game termination marker");
  var peg$e34 = peg$literalExpectation("1-0", false);
  var peg$e35 = peg$literalExpectation("0-1", false);
  var peg$e36 = peg$literalExpectation("1/2-1/2", false);
  var peg$e37 = peg$literalExpectation("*", false);
  var peg$e38 = peg$otherExpectation("whitespace");
  var peg$e39 = peg$classExpectation([" ", "	", "\r", "\n"], false, false);
  var peg$f0 = function(headers, game) {
    return pgn(headers, game);
  };
  var peg$f1 = function(tagPairs) {
    return Object.fromEntries(tagPairs);
  };
  var peg$f2 = function(tagName, tagValue) {
    return [tagName, tagValue];
  };
  var peg$f3 = function(root, marker) {
    return { root, marker };
  };
  var peg$f4 = function(comment, moves) {
    return lineToTree(rootNode(comment), ...moves.flat());
  };
  var peg$f5 = function(san, suffix, nag, comment, variations) {
    return node(san, suffix, nag, comment, variations);
  };
  var peg$f6 = function(nag) {
    return nag;
  };
  var peg$f7 = function(comment) {
    return comment.replace(/[\r\n]+/g, " ");
  };
  var peg$f8 = function(comment) {
    return comment.trim();
  };
  var peg$f9 = function(line) {
    return line;
  };
  var peg$f10 = function(result, comment) {
    return { result, comment };
  };
  var peg$currPos = options.peg$currPos | 0;
  var peg$posDetailsCache = [{ line: 1, column: 1 }];
  var peg$maxFailPos = peg$currPos;
  var peg$maxFailExpected = options.peg$maxFailExpected || [];
  var peg$silentFails = options.peg$silentFails | 0;
  var peg$result;
  if (options.startRule) {
    if (!(options.startRule in peg$startRuleFunctions)) {
      throw new Error(`Can't start parsing from rule "` + options.startRule + '".');
    }
    peg$startRuleFunction = peg$startRuleFunctions[options.startRule];
  }
  function peg$literalExpectation(text, ignoreCase) {
    return { type: "literal", text, ignoreCase };
  }
  function peg$classExpectation(parts, inverted, ignoreCase) {
    return { type: "class", parts, inverted, ignoreCase };
  }
  function peg$endExpectation() {
    return { type: "end" };
  }
  function peg$otherExpectation(description) {
    return { type: "other", description };
  }
  function peg$computePosDetails(pos) {
    var details = peg$posDetailsCache[pos];
    var p;
    if (details) {
      return details;
    } else {
      if (pos >= peg$posDetailsCache.length) {
        p = peg$posDetailsCache.length - 1;
      } else {
        p = pos;
        while (!peg$posDetailsCache[--p]) {
        }
      }
      details = peg$posDetailsCache[p];
      details = {
        line: details.line,
        column: details.column
      };
      while (p < pos) {
        if (input.charCodeAt(p) === 10) {
          details.line++;
          details.column = 1;
        } else {
          details.column++;
        }
        p++;
      }
      peg$posDetailsCache[pos] = details;
      return details;
    }
  }
  function peg$computeLocation(startPos, endPos, offset) {
    var startPosDetails = peg$computePosDetails(startPos);
    var endPosDetails = peg$computePosDetails(endPos);
    var res = {
      source: peg$source,
      start: {
        offset: startPos,
        line: startPosDetails.line,
        column: startPosDetails.column
      },
      end: {
        offset: endPos,
        line: endPosDetails.line,
        column: endPosDetails.column
      }
    };
    return res;
  }
  function peg$fail(expected) {
    if (peg$currPos < peg$maxFailPos) {
      return;
    }
    if (peg$currPos > peg$maxFailPos) {
      peg$maxFailPos = peg$currPos;
      peg$maxFailExpected = [];
    }
    peg$maxFailExpected.push(expected);
  }
  function peg$buildStructuredError(expected, found, location) {
    return new peg$SyntaxError(
      peg$SyntaxError.buildMessage(expected, found),
      expected,
      found,
      location
    );
  }
  function peg$parsepgn() {
    var s0, s1, s2;
    s0 = peg$currPos;
    s1 = peg$parsetagPairSection();
    s2 = peg$parsemoveTextSection();
    s0 = peg$f0(s1, s2);
    return s0;
  }
  function peg$parsetagPairSection() {
    var s0, s1, s2;
    s0 = peg$currPos;
    s1 = [];
    s2 = peg$parsetagPair();
    while (s2 !== peg$FAILED) {
      s1.push(s2);
      s2 = peg$parsetagPair();
    }
    s2 = peg$parse_();
    s0 = peg$f1(s1);
    return s0;
  }
  function peg$parsetagPair() {
    var s0, s2, s4, s6, s7, s8, s10;
    peg$silentFails++;
    s0 = peg$currPos;
    peg$parse_();
    if (input.charCodeAt(peg$currPos) === 91) {
      s2 = peg$c0;
      peg$currPos++;
    } else {
      s2 = peg$FAILED;
      if (peg$silentFails === 0) {
        peg$fail(peg$e1);
      }
    }
    if (s2 !== peg$FAILED) {
      peg$parse_();
      s4 = peg$parsetagName();
      if (s4 !== peg$FAILED) {
        peg$parse_();
        if (input.charCodeAt(peg$currPos) === 34) {
          s6 = peg$c1;
          peg$currPos++;
        } else {
          s6 = peg$FAILED;
          if (peg$silentFails === 0) {
            peg$fail(peg$e2);
          }
        }
        if (s6 !== peg$FAILED) {
          s7 = peg$parsetagValue();
          if (input.charCodeAt(peg$currPos) === 34) {
            s8 = peg$c1;
            peg$currPos++;
          } else {
            s8 = peg$FAILED;
            if (peg$silentFails === 0) {
              peg$fail(peg$e2);
            }
          }
          if (s8 !== peg$FAILED) {
            peg$parse_();
            if (input.charCodeAt(peg$currPos) === 93) {
              s10 = peg$c2;
              peg$currPos++;
            } else {
              s10 = peg$FAILED;
              if (peg$silentFails === 0) {
                peg$fail(peg$e3);
              }
            }
            if (s10 !== peg$FAILED) {
              s0 = peg$f2(s4, s7);
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    peg$silentFails--;
    if (s0 === peg$FAILED) {
      if (peg$silentFails === 0) {
        peg$fail(peg$e0);
      }
    }
    return s0;
  }
  function peg$parsetagName() {
    var s0, s1, s2;
    peg$silentFails++;
    s0 = peg$currPos;
    s1 = [];
    s2 = input.charAt(peg$currPos);
    if (peg$r0.test(s2)) {
      peg$currPos++;
    } else {
      s2 = peg$FAILED;
      if (peg$silentFails === 0) {
        peg$fail(peg$e5);
      }
    }
    if (s2 !== peg$FAILED) {
      while (s2 !== peg$FAILED) {
        s1.push(s2);
        s2 = input.charAt(peg$currPos);
        if (peg$r0.test(s2)) {
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) {
            peg$fail(peg$e5);
          }
        }
      }
    } else {
      s1 = peg$FAILED;
    }
    if (s1 !== peg$FAILED) {
      s0 = input.substring(s0, peg$currPos);
    } else {
      s0 = s1;
    }
    peg$silentFails--;
    if (s0 === peg$FAILED) {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) {
        peg$fail(peg$e4);
      }
    }
    return s0;
  }
  function peg$parsetagValue() {
    var s0, s1, s2;
    peg$silentFails++;
    s0 = peg$currPos;
    s1 = [];
    s2 = input.charAt(peg$currPos);
    if (peg$r1.test(s2)) {
      peg$currPos++;
    } else {
      s2 = peg$FAILED;
      if (peg$silentFails === 0) {
        peg$fail(peg$e7);
      }
    }
    while (s2 !== peg$FAILED) {
      s1.push(s2);
      s2 = input.charAt(peg$currPos);
      if (peg$r1.test(s2)) {
        peg$currPos++;
      } else {
        s2 = peg$FAILED;
        if (peg$silentFails === 0) {
          peg$fail(peg$e7);
        }
      }
    }
    s0 = input.substring(s0, peg$currPos);
    peg$silentFails--;
    s1 = peg$FAILED;
    if (peg$silentFails === 0) {
      peg$fail(peg$e6);
    }
    return s0;
  }
  function peg$parsemoveTextSection() {
    var s0, s1, s3;
    s0 = peg$currPos;
    s1 = peg$parseline();
    peg$parse_();
    s3 = peg$parsegameTerminationMarker();
    if (s3 === peg$FAILED) {
      s3 = null;
    }
    peg$parse_();
    s0 = peg$f3(s1, s3);
    return s0;
  }
  function peg$parseline() {
    var s0, s1, s2, s3;
    s0 = peg$currPos;
    s1 = peg$parsecomment();
    if (s1 === peg$FAILED) {
      s1 = null;
    }
    s2 = [];
    s3 = peg$parsemove();
    while (s3 !== peg$FAILED) {
      s2.push(s3);
      s3 = peg$parsemove();
    }
    s0 = peg$f4(s1, s2);
    return s0;
  }
  function peg$parsemove() {
    var s0, s4, s5, s6, s7, s8, s9, s10;
    s0 = peg$currPos;
    peg$parse_();
    peg$parsemoveNumber();
    peg$parse_();
    s4 = peg$parsesan();
    if (s4 !== peg$FAILED) {
      s5 = peg$parsesuffixAnnotation();
      if (s5 === peg$FAILED) {
        s5 = null;
      }
      s6 = [];
      s7 = peg$parsenag();
      while (s7 !== peg$FAILED) {
        s6.push(s7);
        s7 = peg$parsenag();
      }
      s7 = peg$parse_();
      s8 = peg$parsecomment();
      if (s8 === peg$FAILED) {
        s8 = null;
      }
      s9 = [];
      s10 = peg$parsevariation();
      while (s10 !== peg$FAILED) {
        s9.push(s10);
        s10 = peg$parsevariation();
      }
      s0 = peg$f5(s4, s5, s6, s8, s9);
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    return s0;
  }
  function peg$parsemoveNumber() {
    var s0, s1, s2, s3, s4, s5;
    peg$silentFails++;
    s0 = peg$currPos;
    s1 = [];
    s2 = input.charAt(peg$currPos);
    if (peg$r2.test(s2)) {
      peg$currPos++;
    } else {
      s2 = peg$FAILED;
      if (peg$silentFails === 0) {
        peg$fail(peg$e9);
      }
    }
    while (s2 !== peg$FAILED) {
      s1.push(s2);
      s2 = input.charAt(peg$currPos);
      if (peg$r2.test(s2)) {
        peg$currPos++;
      } else {
        s2 = peg$FAILED;
        if (peg$silentFails === 0) {
          peg$fail(peg$e9);
        }
      }
    }
    if (input.charCodeAt(peg$currPos) === 46) {
      s2 = peg$c3;
      peg$currPos++;
    } else {
      s2 = peg$FAILED;
      if (peg$silentFails === 0) {
        peg$fail(peg$e10);
      }
    }
    if (s2 !== peg$FAILED) {
      s3 = peg$parse_();
      s4 = [];
      s5 = input.charAt(peg$currPos);
      if (peg$r3.test(s5)) {
        peg$currPos++;
      } else {
        s5 = peg$FAILED;
        if (peg$silentFails === 0) {
          peg$fail(peg$e11);
        }
      }
      while (s5 !== peg$FAILED) {
        s4.push(s5);
        s5 = input.charAt(peg$currPos);
        if (peg$r3.test(s5)) {
          peg$currPos++;
        } else {
          s5 = peg$FAILED;
          if (peg$silentFails === 0) {
            peg$fail(peg$e11);
          }
        }
      }
      s1 = [s1, s2, s3, s4];
      s0 = s1;
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    peg$silentFails--;
    if (s0 === peg$FAILED) {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) {
        peg$fail(peg$e8);
      }
    }
    return s0;
  }
  function peg$parsesan() {
    var s0, s1, s2, s3, s4, s5;
    peg$silentFails++;
    s0 = peg$currPos;
    s1 = peg$currPos;
    if (input.substr(peg$currPos, 5) === peg$c4) {
      s2 = peg$c4;
      peg$currPos += 5;
    } else {
      s2 = peg$FAILED;
      if (peg$silentFails === 0) {
        peg$fail(peg$e13);
      }
    }
    if (s2 === peg$FAILED) {
      if (input.substr(peg$currPos, 3) === peg$c5) {
        s2 = peg$c5;
        peg$currPos += 3;
      } else {
        s2 = peg$FAILED;
        if (peg$silentFails === 0) {
          peg$fail(peg$e14);
        }
      }
      if (s2 === peg$FAILED) {
        if (input.substr(peg$currPos, 5) === peg$c6) {
          s2 = peg$c6;
          peg$currPos += 5;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) {
            peg$fail(peg$e15);
          }
        }
        if (s2 === peg$FAILED) {
          if (input.substr(peg$currPos, 3) === peg$c7) {
            s2 = peg$c7;
            peg$currPos += 3;
          } else {
            s2 = peg$FAILED;
            if (peg$silentFails === 0) {
              peg$fail(peg$e16);
            }
          }
          if (s2 === peg$FAILED) {
            s2 = peg$currPos;
            s3 = input.charAt(peg$currPos);
            if (peg$r0.test(s3)) {
              peg$currPos++;
            } else {
              s3 = peg$FAILED;
              if (peg$silentFails === 0) {
                peg$fail(peg$e5);
              }
            }
            if (s3 !== peg$FAILED) {
              s4 = [];
              s5 = input.charAt(peg$currPos);
              if (peg$r4.test(s5)) {
                peg$currPos++;
              } else {
                s5 = peg$FAILED;
                if (peg$silentFails === 0) {
                  peg$fail(peg$e17);
                }
              }
              if (s5 !== peg$FAILED) {
                while (s5 !== peg$FAILED) {
                  s4.push(s5);
                  s5 = input.charAt(peg$currPos);
                  if (peg$r4.test(s5)) {
                    peg$currPos++;
                  } else {
                    s5 = peg$FAILED;
                    if (peg$silentFails === 0) {
                      peg$fail(peg$e17);
                    }
                  }
                }
              } else {
                s4 = peg$FAILED;
              }
              if (s4 !== peg$FAILED) {
                s3 = [s3, s4];
                s2 = s3;
              } else {
                peg$currPos = s2;
                s2 = peg$FAILED;
              }
            } else {
              peg$currPos = s2;
              s2 = peg$FAILED;
            }
          }
        }
      }
    }
    if (s2 !== peg$FAILED) {
      s3 = input.charAt(peg$currPos);
      if (peg$r5.test(s3)) {
        peg$currPos++;
      } else {
        s3 = peg$FAILED;
        if (peg$silentFails === 0) {
          peg$fail(peg$e18);
        }
      }
      if (s3 === peg$FAILED) {
        s3 = null;
      }
      s2 = [s2, s3];
      s1 = s2;
    } else {
      peg$currPos = s1;
      s1 = peg$FAILED;
    }
    if (s1 !== peg$FAILED) {
      s0 = input.substring(s0, peg$currPos);
    } else {
      s0 = s1;
    }
    peg$silentFails--;
    if (s0 === peg$FAILED) {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) {
        peg$fail(peg$e12);
      }
    }
    return s0;
  }
  function peg$parsesuffixAnnotation() {
    var s0, s1, s2;
    peg$silentFails++;
    s0 = peg$currPos;
    s1 = [];
    s2 = input.charAt(peg$currPos);
    if (peg$r6.test(s2)) {
      peg$currPos++;
    } else {
      s2 = peg$FAILED;
      if (peg$silentFails === 0) {
        peg$fail(peg$e20);
      }
    }
    while (s2 !== peg$FAILED) {
      s1.push(s2);
      if (s1.length >= 2) {
        s2 = peg$FAILED;
      } else {
        s2 = input.charAt(peg$currPos);
        if (peg$r6.test(s2)) {
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) {
            peg$fail(peg$e20);
          }
        }
      }
    }
    if (s1.length < 1) {
      peg$currPos = s0;
      s0 = peg$FAILED;
    } else {
      s0 = s1;
    }
    peg$silentFails--;
    if (s0 === peg$FAILED) {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) {
        peg$fail(peg$e19);
      }
    }
    return s0;
  }
  function peg$parsenag() {
    var s0, s2, s3, s4, s5;
    peg$silentFails++;
    s0 = peg$currPos;
    peg$parse_();
    if (input.charCodeAt(peg$currPos) === 36) {
      s2 = peg$c8;
      peg$currPos++;
    } else {
      s2 = peg$FAILED;
      if (peg$silentFails === 0) {
        peg$fail(peg$e22);
      }
    }
    if (s2 !== peg$FAILED) {
      s3 = peg$currPos;
      s4 = [];
      s5 = input.charAt(peg$currPos);
      if (peg$r2.test(s5)) {
        peg$currPos++;
      } else {
        s5 = peg$FAILED;
        if (peg$silentFails === 0) {
          peg$fail(peg$e9);
        }
      }
      if (s5 !== peg$FAILED) {
        while (s5 !== peg$FAILED) {
          s4.push(s5);
          s5 = input.charAt(peg$currPos);
          if (peg$r2.test(s5)) {
            peg$currPos++;
          } else {
            s5 = peg$FAILED;
            if (peg$silentFails === 0) {
              peg$fail(peg$e9);
            }
          }
        }
      } else {
        s4 = peg$FAILED;
      }
      if (s4 !== peg$FAILED) {
        s3 = input.substring(s3, peg$currPos);
      } else {
        s3 = s4;
      }
      if (s3 !== peg$FAILED) {
        s0 = peg$f6(s3);
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    peg$silentFails--;
    if (s0 === peg$FAILED) {
      if (peg$silentFails === 0) {
        peg$fail(peg$e21);
      }
    }
    return s0;
  }
  function peg$parsecomment() {
    var s0;
    s0 = peg$parsebraceComment();
    if (s0 === peg$FAILED) {
      s0 = peg$parserestOfLineComment();
    }
    return s0;
  }
  function peg$parsebraceComment() {
    var s0, s1, s2, s3, s4;
    peg$silentFails++;
    s0 = peg$currPos;
    if (input.charCodeAt(peg$currPos) === 123) {
      s1 = peg$c9;
      peg$currPos++;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) {
        peg$fail(peg$e24);
      }
    }
    if (s1 !== peg$FAILED) {
      s2 = peg$currPos;
      s3 = [];
      s4 = input.charAt(peg$currPos);
      if (peg$r7.test(s4)) {
        peg$currPos++;
      } else {
        s4 = peg$FAILED;
        if (peg$silentFails === 0) {
          peg$fail(peg$e25);
        }
      }
      while (s4 !== peg$FAILED) {
        s3.push(s4);
        s4 = input.charAt(peg$currPos);
        if (peg$r7.test(s4)) {
          peg$currPos++;
        } else {
          s4 = peg$FAILED;
          if (peg$silentFails === 0) {
            peg$fail(peg$e25);
          }
        }
      }
      s2 = input.substring(s2, peg$currPos);
      if (input.charCodeAt(peg$currPos) === 125) {
        s3 = peg$c10;
        peg$currPos++;
      } else {
        s3 = peg$FAILED;
        if (peg$silentFails === 0) {
          peg$fail(peg$e26);
        }
      }
      if (s3 !== peg$FAILED) {
        s0 = peg$f7(s2);
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    peg$silentFails--;
    if (s0 === peg$FAILED) {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) {
        peg$fail(peg$e23);
      }
    }
    return s0;
  }
  function peg$parserestOfLineComment() {
    var s0, s1, s2, s3, s4;
    peg$silentFails++;
    s0 = peg$currPos;
    if (input.charCodeAt(peg$currPos) === 59) {
      s1 = peg$c11;
      peg$currPos++;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) {
        peg$fail(peg$e28);
      }
    }
    if (s1 !== peg$FAILED) {
      s2 = peg$currPos;
      s3 = [];
      s4 = input.charAt(peg$currPos);
      if (peg$r8.test(s4)) {
        peg$currPos++;
      } else {
        s4 = peg$FAILED;
        if (peg$silentFails === 0) {
          peg$fail(peg$e29);
        }
      }
      while (s4 !== peg$FAILED) {
        s3.push(s4);
        s4 = input.charAt(peg$currPos);
        if (peg$r8.test(s4)) {
          peg$currPos++;
        } else {
          s4 = peg$FAILED;
          if (peg$silentFails === 0) {
            peg$fail(peg$e29);
          }
        }
      }
      s2 = input.substring(s2, peg$currPos);
      s0 = peg$f8(s2);
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    peg$silentFails--;
    if (s0 === peg$FAILED) {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) {
        peg$fail(peg$e27);
      }
    }
    return s0;
  }
  function peg$parsevariation() {
    var s0, s2, s3, s5;
    peg$silentFails++;
    s0 = peg$currPos;
    peg$parse_();
    if (input.charCodeAt(peg$currPos) === 40) {
      s2 = peg$c12;
      peg$currPos++;
    } else {
      s2 = peg$FAILED;
      if (peg$silentFails === 0) {
        peg$fail(peg$e31);
      }
    }
    if (s2 !== peg$FAILED) {
      s3 = peg$parseline();
      if (s3 !== peg$FAILED) {
        peg$parse_();
        if (input.charCodeAt(peg$currPos) === 41) {
          s5 = peg$c13;
          peg$currPos++;
        } else {
          s5 = peg$FAILED;
          if (peg$silentFails === 0) {
            peg$fail(peg$e32);
          }
        }
        if (s5 !== peg$FAILED) {
          s0 = peg$f9(s3);
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    peg$silentFails--;
    if (s0 === peg$FAILED) {
      if (peg$silentFails === 0) {
        peg$fail(peg$e30);
      }
    }
    return s0;
  }
  function peg$parsegameTerminationMarker() {
    var s0, s1, s3;
    peg$silentFails++;
    s0 = peg$currPos;
    if (input.substr(peg$currPos, 3) === peg$c14) {
      s1 = peg$c14;
      peg$currPos += 3;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) {
        peg$fail(peg$e34);
      }
    }
    if (s1 === peg$FAILED) {
      if (input.substr(peg$currPos, 3) === peg$c15) {
        s1 = peg$c15;
        peg$currPos += 3;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) {
          peg$fail(peg$e35);
        }
      }
      if (s1 === peg$FAILED) {
        if (input.substr(peg$currPos, 7) === peg$c16) {
          s1 = peg$c16;
          peg$currPos += 7;
        } else {
          s1 = peg$FAILED;
          if (peg$silentFails === 0) {
            peg$fail(peg$e36);
          }
        }
        if (s1 === peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 42) {
            s1 = peg$c17;
            peg$currPos++;
          } else {
            s1 = peg$FAILED;
            if (peg$silentFails === 0) {
              peg$fail(peg$e37);
            }
          }
        }
      }
    }
    if (s1 !== peg$FAILED) {
      peg$parse_();
      s3 = peg$parsecomment();
      if (s3 === peg$FAILED) {
        s3 = null;
      }
      s0 = peg$f10(s1, s3);
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    peg$silentFails--;
    if (s0 === peg$FAILED) {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) {
        peg$fail(peg$e33);
      }
    }
    return s0;
  }
  function peg$parse_() {
    var s0, s1;
    peg$silentFails++;
    s0 = [];
    s1 = input.charAt(peg$currPos);
    if (peg$r9.test(s1)) {
      peg$currPos++;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) {
        peg$fail(peg$e39);
      }
    }
    while (s1 !== peg$FAILED) {
      s0.push(s1);
      s1 = input.charAt(peg$currPos);
      if (peg$r9.test(s1)) {
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) {
          peg$fail(peg$e39);
        }
      }
    }
    peg$silentFails--;
    s1 = peg$FAILED;
    if (peg$silentFails === 0) {
      peg$fail(peg$e38);
    }
    return s0;
  }
  peg$result = peg$startRuleFunction();
  if (options.peg$library) {
    return (
      /** @type {any} */
      {
        peg$result,
        peg$currPos,
        peg$FAILED,
        peg$maxFailExpected,
        peg$maxFailPos
      }
    );
  }
  if (peg$result !== peg$FAILED && peg$currPos === input.length) {
    return peg$result;
  } else {
    if (peg$result !== peg$FAILED && peg$currPos < input.length) {
      peg$fail(peg$endExpectation());
    }
    throw peg$buildStructuredError(
      peg$maxFailExpected,
      peg$maxFailPos < input.length ? input.charAt(peg$maxFailPos) : null,
      peg$maxFailPos < input.length ? peg$computeLocation(peg$maxFailPos, peg$maxFailPos + 1) : peg$computeLocation(peg$maxFailPos, peg$maxFailPos)
    );
  }
}
var MASK64 = 0xffffffffffffffffn;
function rotl(x, k) {
  return (x << k | x >> 64n - k) & 0xffffffffffffffffn;
}
function wrappingMul(x, y) {
  return x * y & MASK64;
}
function xoroshiro128(state) {
  return function() {
    let s0 = BigInt(state & MASK64);
    let s1 = BigInt(state >> 64n & MASK64);
    const result = wrappingMul(rotl(wrappingMul(s0, 5n), 7n), 9n);
    s1 ^= s0;
    s0 = (rotl(s0, 24n) ^ s1 ^ s1 << 16n) & MASK64;
    s1 = rotl(s1, 37n);
    state = s1 << 64n | s0;
    return result;
  };
}
var rand = xoroshiro128(0xa187eb39cdcaed8f31c4b365b102e01en);
var PIECE_KEYS = Array.from({ length: 2 }, () => Array.from({ length: 6 }, () => Array.from({ length: 128 }, () => rand())));
var EP_KEYS = Array.from({ length: 8 }, () => rand());
var CASTLING_KEYS = Array.from({ length: 16 }, () => rand());
var SIDE_KEY = rand();
var WHITE = "w";
var BLACK = "b";
var PAWN = "p";
var KNIGHT = "n";
var BISHOP = "b";
var ROOK = "r";
var QUEEN = "q";
var KING = "k";
var DEFAULT_POSITION = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
var Move = class {
  color;
  from;
  to;
  piece;
  captured;
  promotion;
  /**
   * @deprecated This field is deprecated and will be removed in version 2.0.0.
   * Please use move descriptor functions instead: `isCapture`, `isPromotion`,
   * `isEnPassant`, `isKingsideCastle`, `isQueensideCastle`, `isCastle`, and
   * `isBigPawn`
   */
  flags;
  san;
  lan;
  before;
  after;
  constructor(chess2, internal) {
    const { color, piece, from, to, flags, captured, promotion } = internal;
    const fromAlgebraic = algebraic(from);
    const toAlgebraic = algebraic(to);
    this.color = color;
    this.piece = piece;
    this.from = fromAlgebraic;
    this.to = toAlgebraic;
    this.san = chess2["_moveToSan"](internal, chess2["_moves"]({ legal: true }));
    this.lan = fromAlgebraic + toAlgebraic;
    this.before = chess2.fen();
    chess2["_makeMove"](internal);
    this.after = chess2.fen();
    chess2["_undoMove"]();
    this.flags = "";
    for (const flag in BITS) {
      if (BITS[flag] & flags) {
        this.flags += FLAGS[flag];
      }
    }
    if (captured) {
      this.captured = captured;
    }
    if (promotion) {
      this.promotion = promotion;
      this.lan += promotion;
    }
  }
  isCapture() {
    return this.flags.indexOf(FLAGS["CAPTURE"]) > -1;
  }
  isPromotion() {
    return this.flags.indexOf(FLAGS["PROMOTION"]) > -1;
  }
  isEnPassant() {
    return this.flags.indexOf(FLAGS["EP_CAPTURE"]) > -1;
  }
  isKingsideCastle() {
    return this.flags.indexOf(FLAGS["KSIDE_CASTLE"]) > -1;
  }
  isQueensideCastle() {
    return this.flags.indexOf(FLAGS["QSIDE_CASTLE"]) > -1;
  }
  isBigPawn() {
    return this.flags.indexOf(FLAGS["BIG_PAWN"]) > -1;
  }
};
var EMPTY = -1;
var FLAGS = {
  NORMAL: "n",
  CAPTURE: "c",
  BIG_PAWN: "b",
  EP_CAPTURE: "e",
  PROMOTION: "p",
  KSIDE_CASTLE: "k",
  QSIDE_CASTLE: "q",
  NULL_MOVE: "-"
};
var BITS = {
  NORMAL: 1,
  CAPTURE: 2,
  BIG_PAWN: 4,
  EP_CAPTURE: 8,
  PROMOTION: 16,
  KSIDE_CASTLE: 32,
  QSIDE_CASTLE: 64,
  NULL_MOVE: 128
};
var SEVEN_TAG_ROSTER = {
  Event: "?",
  Site: "?",
  Date: "????.??.??",
  Round: "?",
  White: "?",
  Black: "?",
  Result: "*"
};
var SUPLEMENTAL_TAGS = {
  WhiteTitle: null,
  BlackTitle: null,
  WhiteElo: null,
  BlackElo: null,
  WhiteUSCF: null,
  BlackUSCF: null,
  WhiteNA: null,
  BlackNA: null,
  WhiteType: null,
  BlackType: null,
  EventDate: null,
  EventSponsor: null,
  Section: null,
  Stage: null,
  Board: null,
  Opening: null,
  Variation: null,
  SubVariation: null,
  ECO: null,
  NIC: null,
  Time: null,
  UTCTime: null,
  UTCDate: null,
  TimeControl: null,
  SetUp: null,
  FEN: null,
  Termination: null,
  Annotator: null,
  Mode: null,
  PlyCount: null
};
var HEADER_TEMPLATE = {
  ...SEVEN_TAG_ROSTER,
  ...SUPLEMENTAL_TAGS
};
var Ox88 = {
  a8: 0,
  b8: 1,
  c8: 2,
  d8: 3,
  e8: 4,
  f8: 5,
  g8: 6,
  h8: 7,
  a7: 16,
  b7: 17,
  c7: 18,
  d7: 19,
  e7: 20,
  f7: 21,
  g7: 22,
  h7: 23,
  a6: 32,
  b6: 33,
  c6: 34,
  d6: 35,
  e6: 36,
  f6: 37,
  g6: 38,
  h6: 39,
  a5: 48,
  b5: 49,
  c5: 50,
  d5: 51,
  e5: 52,
  f5: 53,
  g5: 54,
  h5: 55,
  a4: 64,
  b4: 65,
  c4: 66,
  d4: 67,
  e4: 68,
  f4: 69,
  g4: 70,
  h4: 71,
  a3: 80,
  b3: 81,
  c3: 82,
  d3: 83,
  e3: 84,
  f3: 85,
  g3: 86,
  h3: 87,
  a2: 96,
  b2: 97,
  c2: 98,
  d2: 99,
  e2: 100,
  f2: 101,
  g2: 102,
  h2: 103,
  a1: 112,
  b1: 113,
  c1: 114,
  d1: 115,
  e1: 116,
  f1: 117,
  g1: 118,
  h1: 119
};
var PAWN_OFFSETS = {
  b: [16, 32, 17, 15],
  w: [-16, -32, -17, -15]
};
var PIECE_OFFSETS = {
  n: [-18, -33, -31, -14, 18, 33, 31, 14],
  b: [-17, -15, 17, 15],
  r: [-16, 1, 16, -1],
  q: [-17, -16, -15, 1, 17, 16, 15, -1],
  k: [-17, -16, -15, 1, 17, 16, 15, -1]
};
var ATTACKS = [
  20,
  0,
  0,
  0,
  0,
  0,
  0,
  24,
  0,
  0,
  0,
  0,
  0,
  0,
  20,
  0,
  0,
  20,
  0,
  0,
  0,
  0,
  0,
  24,
  0,
  0,
  0,
  0,
  0,
  20,
  0,
  0,
  0,
  0,
  20,
  0,
  0,
  0,
  0,
  24,
  0,
  0,
  0,
  0,
  20,
  0,
  0,
  0,
  0,
  0,
  0,
  20,
  0,
  0,
  0,
  24,
  0,
  0,
  0,
  20,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  20,
  0,
  0,
  24,
  0,
  0,
  20,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  20,
  2,
  24,
  2,
  20,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  2,
  53,
  56,
  53,
  2,
  0,
  0,
  0,
  0,
  0,
  0,
  24,
  24,
  24,
  24,
  24,
  24,
  56,
  0,
  56,
  24,
  24,
  24,
  24,
  24,
  24,
  0,
  0,
  0,
  0,
  0,
  0,
  2,
  53,
  56,
  53,
  2,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  20,
  2,
  24,
  2,
  20,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  20,
  0,
  0,
  24,
  0,
  0,
  20,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  20,
  0,
  0,
  0,
  24,
  0,
  0,
  0,
  20,
  0,
  0,
  0,
  0,
  0,
  0,
  20,
  0,
  0,
  0,
  0,
  24,
  0,
  0,
  0,
  0,
  20,
  0,
  0,
  0,
  0,
  20,
  0,
  0,
  0,
  0,
  0,
  24,
  0,
  0,
  0,
  0,
  0,
  20,
  0,
  0,
  20,
  0,
  0,
  0,
  0,
  0,
  0,
  24,
  0,
  0,
  0,
  0,
  0,
  0,
  20
];
var RAYS = [
  17,
  0,
  0,
  0,
  0,
  0,
  0,
  16,
  0,
  0,
  0,
  0,
  0,
  0,
  15,
  0,
  0,
  17,
  0,
  0,
  0,
  0,
  0,
  16,
  0,
  0,
  0,
  0,
  0,
  15,
  0,
  0,
  0,
  0,
  17,
  0,
  0,
  0,
  0,
  16,
  0,
  0,
  0,
  0,
  15,
  0,
  0,
  0,
  0,
  0,
  0,
  17,
  0,
  0,
  0,
  16,
  0,
  0,
  0,
  15,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  17,
  0,
  0,
  16,
  0,
  0,
  15,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  17,
  0,
  16,
  0,
  15,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  17,
  16,
  15,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  0,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  -15,
  -16,
  -17,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  -15,
  0,
  -16,
  0,
  -17,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  -15,
  0,
  0,
  -16,
  0,
  0,
  -17,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  -15,
  0,
  0,
  0,
  -16,
  0,
  0,
  0,
  -17,
  0,
  0,
  0,
  0,
  0,
  0,
  -15,
  0,
  0,
  0,
  0,
  -16,
  0,
  0,
  0,
  0,
  -17,
  0,
  0,
  0,
  0,
  -15,
  0,
  0,
  0,
  0,
  0,
  -16,
  0,
  0,
  0,
  0,
  0,
  -17,
  0,
  0,
  -15,
  0,
  0,
  0,
  0,
  0,
  0,
  -16,
  0,
  0,
  0,
  0,
  0,
  0,
  -17
];
var PIECE_MASKS = { p: 1, n: 2, b: 4, r: 8, q: 16, k: 32 };
var SYMBOLS = "pnbrqkPNBRQK";
var PROMOTIONS = [KNIGHT, BISHOP, ROOK, QUEEN];
var RANK_1 = 7;
var RANK_2 = 6;
var RANK_7 = 1;
var RANK_8 = 0;
var SIDES = {
  [KING]: BITS.KSIDE_CASTLE,
  [QUEEN]: BITS.QSIDE_CASTLE
};
var ROOKS = {
  w: [
    { square: Ox88.a1, flag: BITS.QSIDE_CASTLE },
    { square: Ox88.h1, flag: BITS.KSIDE_CASTLE }
  ],
  b: [
    { square: Ox88.a8, flag: BITS.QSIDE_CASTLE },
    { square: Ox88.h8, flag: BITS.KSIDE_CASTLE }
  ]
};
var SECOND_RANK = { b: RANK_7, w: RANK_2 };
var SAN_NULLMOVE = "--";
function rank(square) {
  return square >> 4;
}
function file(square) {
  return square & 15;
}
function isDigit(c) {
  return "0123456789".indexOf(c) !== -1;
}
function algebraic(square) {
  const f = file(square);
  const r = rank(square);
  return "abcdefgh".substring(f, f + 1) + "87654321".substring(r, r + 1);
}
function swapColor(color) {
  return color === WHITE ? BLACK : WHITE;
}
function validateFen(fen) {
  const tokens = fen.split(/\s+/);
  if (tokens.length !== 6) {
    return {
      ok: false,
      error: "Invalid FEN: must contain six space-delimited fields"
    };
  }
  const moveNumber = parseInt(tokens[5], 10);
  if (isNaN(moveNumber) || moveNumber <= 0) {
    return {
      ok: false,
      error: "Invalid FEN: move number must be a positive integer"
    };
  }
  const halfMoves = parseInt(tokens[4], 10);
  if (isNaN(halfMoves) || halfMoves < 0) {
    return {
      ok: false,
      error: "Invalid FEN: half move counter number must be a non-negative integer"
    };
  }
  if (!/^(-|[abcdefgh][36])$/.test(tokens[3])) {
    return { ok: false, error: "Invalid FEN: en-passant square is invalid" };
  }
  if (/[^kKqQ-]/.test(tokens[2])) {
    return { ok: false, error: "Invalid FEN: castling availability is invalid" };
  }
  if (!/^(w|b)$/.test(tokens[1])) {
    return { ok: false, error: "Invalid FEN: side-to-move is invalid" };
  }
  const rows = tokens[0].split("/");
  if (rows.length !== 8) {
    return {
      ok: false,
      error: "Invalid FEN: piece data does not contain 8 '/'-delimited rows"
    };
  }
  for (let i = 0; i < rows.length; i++) {
    let sumFields = 0;
    let previousWasNumber = false;
    for (let k = 0; k < rows[i].length; k++) {
      if (isDigit(rows[i][k])) {
        if (previousWasNumber) {
          return {
            ok: false,
            error: "Invalid FEN: piece data is invalid (consecutive number)"
          };
        }
        sumFields += parseInt(rows[i][k], 10);
        previousWasNumber = true;
      } else {
        if (!/^[prnbqkPRNBQK]$/.test(rows[i][k])) {
          return {
            ok: false,
            error: "Invalid FEN: piece data is invalid (invalid piece)"
          };
        }
        sumFields += 1;
        previousWasNumber = false;
      }
    }
    if (sumFields !== 8) {
      return {
        ok: false,
        error: "Invalid FEN: piece data is invalid (too many squares in rank)"
      };
    }
  }
  if (tokens[3][1] == "3" && tokens[1] == "w" || tokens[3][1] == "6" && tokens[1] == "b") {
    return { ok: false, error: "Invalid FEN: illegal en-passant square" };
  }
  const kings = [
    { color: "white", regex: /K/g },
    { color: "black", regex: /k/g }
  ];
  for (const { color, regex } of kings) {
    if (!regex.test(tokens[0])) {
      return { ok: false, error: `Invalid FEN: missing ${color} king` };
    }
    if ((tokens[0].match(regex) || []).length > 1) {
      return { ok: false, error: `Invalid FEN: too many ${color} kings` };
    }
  }
  if (Array.from(rows[0] + rows[7]).some((char) => char.toUpperCase() === "P")) {
    return {
      ok: false,
      error: "Invalid FEN: some pawns are on the edge rows"
    };
  }
  return { ok: true };
}
function getDisambiguator(move, moves) {
  const from = move.from;
  const to = move.to;
  const piece = move.piece;
  let ambiguities = 0;
  let sameRank = 0;
  let sameFile = 0;
  for (let i = 0, len = moves.length; i < len; i++) {
    const ambigFrom = moves[i].from;
    const ambigTo = moves[i].to;
    const ambigPiece = moves[i].piece;
    if (piece === ambigPiece && from !== ambigFrom && to === ambigTo) {
      ambiguities++;
      if (rank(from) === rank(ambigFrom)) {
        sameRank++;
      }
      if (file(from) === file(ambigFrom)) {
        sameFile++;
      }
    }
  }
  if (ambiguities > 0) {
    if (sameRank > 0 && sameFile > 0) {
      return algebraic(from);
    } else if (sameFile > 0) {
      return algebraic(from).charAt(1);
    } else {
      return algebraic(from).charAt(0);
    }
  }
  return "";
}
function addMove(moves, color, from, to, piece, captured = void 0, flags = BITS.NORMAL) {
  const r = rank(to);
  if (piece === PAWN && (r === RANK_1 || r === RANK_8)) {
    for (let i = 0; i < PROMOTIONS.length; i++) {
      const promotion = PROMOTIONS[i];
      moves.push({
        color,
        from,
        to,
        piece,
        captured,
        promotion,
        flags: flags | BITS.PROMOTION
      });
    }
  } else {
    moves.push({
      color,
      from,
      to,
      piece,
      captured,
      flags
    });
  }
}
function inferPieceType(san) {
  let pieceType = san.charAt(0);
  if (pieceType >= "a" && pieceType <= "h") {
    const matches = san.match(/[a-h]\d.*[a-h]\d/);
    if (matches) {
      return void 0;
    }
    return PAWN;
  }
  pieceType = pieceType.toLowerCase();
  if (pieceType === "o") {
    return KING;
  }
  return pieceType;
}
function strippedSan(move) {
  return move.replace(/=/, "").replace(/[+#]?[?!]*$/, "");
}
var Chess = class {
  _board = new Array(128);
  _turn = WHITE;
  _header = {};
  _kings = { w: EMPTY, b: EMPTY };
  _epSquare = -1;
  _halfMoves = 0;
  _moveNumber = 0;
  _history = [];
  _comments = {};
  _castling = { w: 0, b: 0 };
  _hash = 0n;
  // tracks number of times a position has been seen for repetition checking
  _positionCount = /* @__PURE__ */ new Map();
  constructor(fen = DEFAULT_POSITION, { skipValidation = false } = {}) {
    this.load(fen, { skipValidation });
  }
  clear({ preserveHeaders = false } = {}) {
    this._board = new Array(128);
    this._kings = { w: EMPTY, b: EMPTY };
    this._turn = WHITE;
    this._castling = { w: 0, b: 0 };
    this._epSquare = EMPTY;
    this._halfMoves = 0;
    this._moveNumber = 1;
    this._history = [];
    this._comments = {};
    this._header = preserveHeaders ? this._header : { ...HEADER_TEMPLATE };
    this._hash = this._computeHash();
    this._positionCount = /* @__PURE__ */ new Map();
    this._header["SetUp"] = null;
    this._header["FEN"] = null;
  }
  load(fen, { skipValidation = false, preserveHeaders = false } = {}) {
    let tokens = fen.split(/\s+/);
    if (tokens.length >= 2 && tokens.length < 6) {
      const adjustments = ["-", "-", "0", "1"];
      fen = tokens.concat(adjustments.slice(-(6 - tokens.length))).join(" ");
    }
    tokens = fen.split(/\s+/);
    if (!skipValidation) {
      const { ok, error } = validateFen(fen);
      if (!ok) {
        throw new Error(error);
      }
    }
    const position = tokens[0];
    let square = 0;
    this.clear({ preserveHeaders });
    for (let i = 0; i < position.length; i++) {
      const piece = position.charAt(i);
      if (piece === "/") {
        square += 8;
      } else if (isDigit(piece)) {
        square += parseInt(piece, 10);
      } else {
        const color = piece < "a" ? WHITE : BLACK;
        this._put({ type: piece.toLowerCase(), color }, algebraic(square));
        square++;
      }
    }
    this._turn = tokens[1];
    if (tokens[2].indexOf("K") > -1) {
      this._castling.w |= BITS.KSIDE_CASTLE;
    }
    if (tokens[2].indexOf("Q") > -1) {
      this._castling.w |= BITS.QSIDE_CASTLE;
    }
    if (tokens[2].indexOf("k") > -1) {
      this._castling.b |= BITS.KSIDE_CASTLE;
    }
    if (tokens[2].indexOf("q") > -1) {
      this._castling.b |= BITS.QSIDE_CASTLE;
    }
    this._epSquare = tokens[3] === "-" ? EMPTY : Ox88[tokens[3]];
    this._halfMoves = parseInt(tokens[4], 10);
    this._moveNumber = parseInt(tokens[5], 10);
    this._hash = this._computeHash();
    this._updateSetup(fen);
    this._incPositionCount();
  }
  fen({ forceEnpassantSquare = false } = {}) {
    let empty = 0;
    let fen = "";
    for (let i = Ox88.a8; i <= Ox88.h1; i++) {
      if (this._board[i]) {
        if (empty > 0) {
          fen += empty;
          empty = 0;
        }
        const { color, type: piece } = this._board[i];
        fen += color === WHITE ? piece.toUpperCase() : piece.toLowerCase();
      } else {
        empty++;
      }
      if (i + 1 & 136) {
        if (empty > 0) {
          fen += empty;
        }
        if (i !== Ox88.h1) {
          fen += "/";
        }
        empty = 0;
        i += 8;
      }
    }
    let castling = "";
    if (this._castling[WHITE] & BITS.KSIDE_CASTLE) {
      castling += "K";
    }
    if (this._castling[WHITE] & BITS.QSIDE_CASTLE) {
      castling += "Q";
    }
    if (this._castling[BLACK] & BITS.KSIDE_CASTLE) {
      castling += "k";
    }
    if (this._castling[BLACK] & BITS.QSIDE_CASTLE) {
      castling += "q";
    }
    castling = castling || "-";
    let epSquare = "-";
    if (this._epSquare !== EMPTY) {
      if (forceEnpassantSquare) {
        epSquare = algebraic(this._epSquare);
      } else {
        const bigPawnSquare = this._epSquare + (this._turn === WHITE ? 16 : -16);
        const squares = [bigPawnSquare + 1, bigPawnSquare - 1];
        for (const square of squares) {
          if (square & 136) {
            continue;
          }
          const color = this._turn;
          if (this._board[square]?.color === color && this._board[square]?.type === PAWN) {
            this._makeMove({
              color,
              from: square,
              to: this._epSquare,
              piece: PAWN,
              captured: PAWN,
              flags: BITS.EP_CAPTURE
            });
            const isLegal = !this._isKingAttacked(color);
            this._undoMove();
            if (isLegal) {
              epSquare = algebraic(this._epSquare);
              break;
            }
          }
        }
      }
    }
    return [
      fen,
      this._turn,
      castling,
      epSquare,
      this._halfMoves,
      this._moveNumber
    ].join(" ");
  }
  _pieceKey(i) {
    if (!this._board[i]) {
      return 0n;
    }
    const { color, type } = this._board[i];
    const colorIndex = {
      w: 0,
      b: 1
    }[color];
    const typeIndex = {
      p: 0,
      n: 1,
      b: 2,
      r: 3,
      q: 4,
      k: 5
    }[type];
    return PIECE_KEYS[colorIndex][typeIndex][i];
  }
  _epKey() {
    return this._epSquare === EMPTY ? 0n : EP_KEYS[this._epSquare & 7];
  }
  _castlingKey() {
    const index = this._castling.w >> 5 | this._castling.b >> 3;
    return CASTLING_KEYS[index];
  }
  _computeHash() {
    let hash = 0n;
    for (let i = Ox88.a8; i <= Ox88.h1; i++) {
      if (i & 136) {
        i += 7;
        continue;
      }
      if (this._board[i]) {
        hash ^= this._pieceKey(i);
      }
    }
    hash ^= this._epKey();
    hash ^= this._castlingKey();
    if (this._turn === "b") {
      hash ^= SIDE_KEY;
    }
    return hash;
  }
  /*
   * Called when the initial board setup is changed with put() or remove().
   * modifies the SetUp and FEN properties of the header object. If the FEN
   * is equal to the default position, the SetUp and FEN are deleted the setup
   * is only updated if history.length is zero, ie moves haven't been made.
   */
  _updateSetup(fen) {
    if (this._history.length > 0)
      return;
    if (fen !== DEFAULT_POSITION) {
      this._header["SetUp"] = "1";
      this._header["FEN"] = fen;
    } else {
      this._header["SetUp"] = null;
      this._header["FEN"] = null;
    }
  }
  reset() {
    this.load(DEFAULT_POSITION);
  }
  get(square) {
    return this._board[Ox88[square]];
  }
  findPiece(piece) {
    const squares = [];
    for (let i = Ox88.a8; i <= Ox88.h1; i++) {
      if (i & 136) {
        i += 7;
        continue;
      }
      if (!this._board[i] || this._board[i]?.color !== piece.color) {
        continue;
      }
      if (this._board[i].color === piece.color && this._board[i].type === piece.type) {
        squares.push(algebraic(i));
      }
    }
    return squares;
  }
  put({ type, color }, square) {
    if (this._put({ type, color }, square)) {
      this._updateCastlingRights();
      this._updateEnPassantSquare();
      this._updateSetup(this.fen());
      return true;
    }
    return false;
  }
  _set(sq, piece) {
    this._hash ^= this._pieceKey(sq);
    this._board[sq] = piece;
    this._hash ^= this._pieceKey(sq);
  }
  _put({ type, color }, square) {
    if (SYMBOLS.indexOf(type.toLowerCase()) === -1) {
      return false;
    }
    if (!(square in Ox88)) {
      return false;
    }
    const sq = Ox88[square];
    if (type == KING && !(this._kings[color] == EMPTY || this._kings[color] == sq)) {
      return false;
    }
    const currentPieceOnSquare = this._board[sq];
    if (currentPieceOnSquare && currentPieceOnSquare.type === KING) {
      this._kings[currentPieceOnSquare.color] = EMPTY;
    }
    this._set(sq, { type, color });
    if (type === KING) {
      this._kings[color] = sq;
    }
    return true;
  }
  _clear(sq) {
    this._hash ^= this._pieceKey(sq);
    delete this._board[sq];
  }
  remove(square) {
    const piece = this.get(square);
    this._clear(Ox88[square]);
    if (piece && piece.type === KING) {
      this._kings[piece.color] = EMPTY;
    }
    this._updateCastlingRights();
    this._updateEnPassantSquare();
    this._updateSetup(this.fen());
    return piece;
  }
  _updateCastlingRights() {
    this._hash ^= this._castlingKey();
    const whiteKingInPlace = this._board[Ox88.e1]?.type === KING && this._board[Ox88.e1]?.color === WHITE;
    const blackKingInPlace = this._board[Ox88.e8]?.type === KING && this._board[Ox88.e8]?.color === BLACK;
    if (!whiteKingInPlace || this._board[Ox88.a1]?.type !== ROOK || this._board[Ox88.a1]?.color !== WHITE) {
      this._castling.w &= -65;
    }
    if (!whiteKingInPlace || this._board[Ox88.h1]?.type !== ROOK || this._board[Ox88.h1]?.color !== WHITE) {
      this._castling.w &= -33;
    }
    if (!blackKingInPlace || this._board[Ox88.a8]?.type !== ROOK || this._board[Ox88.a8]?.color !== BLACK) {
      this._castling.b &= -65;
    }
    if (!blackKingInPlace || this._board[Ox88.h8]?.type !== ROOK || this._board[Ox88.h8]?.color !== BLACK) {
      this._castling.b &= -33;
    }
    this._hash ^= this._castlingKey();
  }
  _updateEnPassantSquare() {
    if (this._epSquare === EMPTY) {
      return;
    }
    const startSquare = this._epSquare + (this._turn === WHITE ? -16 : 16);
    const currentSquare = this._epSquare + (this._turn === WHITE ? 16 : -16);
    const attackers = [currentSquare + 1, currentSquare - 1];
    if (this._board[startSquare] !== null || this._board[this._epSquare] !== null || this._board[currentSquare]?.color !== swapColor(this._turn) || this._board[currentSquare]?.type !== PAWN) {
      this._hash ^= this._epKey();
      this._epSquare = EMPTY;
      return;
    }
    const canCapture = (square) => !(square & 136) && this._board[square]?.color === this._turn && this._board[square]?.type === PAWN;
    if (!attackers.some(canCapture)) {
      this._hash ^= this._epKey();
      this._epSquare = EMPTY;
    }
  }
  _attacked(color, square, verbose) {
    const attackers = [];
    for (let i = Ox88.a8; i <= Ox88.h1; i++) {
      if (i & 136) {
        i += 7;
        continue;
      }
      if (this._board[i] === void 0 || this._board[i].color !== color) {
        continue;
      }
      const piece = this._board[i];
      const difference = i - square;
      if (difference === 0) {
        continue;
      }
      const index = difference + 119;
      if (ATTACKS[index] & PIECE_MASKS[piece.type]) {
        if (piece.type === PAWN) {
          if (difference > 0 && piece.color === WHITE || difference <= 0 && piece.color === BLACK) {
            if (!verbose) {
              return true;
            } else {
              attackers.push(algebraic(i));
            }
          }
          continue;
        }
        if (piece.type === "n" || piece.type === "k") {
          if (!verbose) {
            return true;
          } else {
            attackers.push(algebraic(i));
            continue;
          }
        }
        const offset = RAYS[index];
        let j = i + offset;
        let blocked = false;
        while (j !== square) {
          if (this._board[j] != null) {
            blocked = true;
            break;
          }
          j += offset;
        }
        if (!blocked) {
          if (!verbose) {
            return true;
          } else {
            attackers.push(algebraic(i));
            continue;
          }
        }
      }
    }
    if (verbose) {
      return attackers;
    } else {
      return false;
    }
  }
  attackers(square, attackedBy) {
    if (!attackedBy) {
      return this._attacked(this._turn, Ox88[square], true);
    } else {
      return this._attacked(attackedBy, Ox88[square], true);
    }
  }
  _isKingAttacked(color) {
    const square = this._kings[color];
    return square === -1 ? false : this._attacked(swapColor(color), square);
  }
  hash() {
    return this._hash.toString(16);
  }
  isAttacked(square, attackedBy) {
    return this._attacked(attackedBy, Ox88[square]);
  }
  isCheck() {
    return this._isKingAttacked(this._turn);
  }
  inCheck() {
    return this.isCheck();
  }
  isCheckmate() {
    return this.isCheck() && this._moves().length === 0;
  }
  isStalemate() {
    return !this.isCheck() && this._moves().length === 0;
  }
  isInsufficientMaterial() {
    const pieces = {
      b: 0,
      n: 0,
      r: 0,
      q: 0,
      k: 0,
      p: 0
    };
    const bishops = [];
    let numPieces = 0;
    let squareColor = 0;
    for (let i = Ox88.a8; i <= Ox88.h1; i++) {
      squareColor = (squareColor + 1) % 2;
      if (i & 136) {
        i += 7;
        continue;
      }
      const piece = this._board[i];
      if (piece) {
        pieces[piece.type] = piece.type in pieces ? pieces[piece.type] + 1 : 1;
        if (piece.type === BISHOP) {
          bishops.push(squareColor);
        }
        numPieces++;
      }
    }
    if (numPieces === 2) {
      return true;
    } else if (
      // k vs. kn .... or .... k vs. kb
      numPieces === 3 && (pieces[BISHOP] === 1 || pieces[KNIGHT] === 1)
    ) {
      return true;
    } else if (numPieces === pieces[BISHOP] + 2) {
      let sum = 0;
      const len = bishops.length;
      for (let i = 0; i < len; i++) {
        sum += bishops[i];
      }
      if (sum === 0 || sum === len) {
        return true;
      }
    }
    return false;
  }
  isThreefoldRepetition() {
    return this._getPositionCount(this._hash) >= 3;
  }
  isDrawByFiftyMoves() {
    return this._halfMoves >= 100;
  }
  isDraw() {
    return this.isDrawByFiftyMoves() || this.isStalemate() || this.isInsufficientMaterial() || this.isThreefoldRepetition();
  }
  isGameOver() {
    return this.isCheckmate() || this.isDraw();
  }
  moves({ verbose = false, square = void 0, piece = void 0 } = {}) {
    const moves = this._moves({ square, piece });
    if (verbose) {
      return moves.map((move) => new Move(this, move));
    } else {
      return moves.map((move) => this._moveToSan(move, moves));
    }
  }
  _moves({ legal = true, piece = void 0, square = void 0 } = {}) {
    const forSquare = square ? square.toLowerCase() : void 0;
    const forPiece = piece?.toLowerCase();
    const moves = [];
    const us = this._turn;
    const them = swapColor(us);
    let firstSquare = Ox88.a8;
    let lastSquare = Ox88.h1;
    let singleSquare = false;
    if (forSquare) {
      if (!(forSquare in Ox88)) {
        return [];
      } else {
        firstSquare = lastSquare = Ox88[forSquare];
        singleSquare = true;
      }
    }
    for (let from = firstSquare; from <= lastSquare; from++) {
      if (from & 136) {
        from += 7;
        continue;
      }
      if (!this._board[from] || this._board[from].color === them) {
        continue;
      }
      const { type } = this._board[from];
      let to;
      if (type === PAWN) {
        if (forPiece && forPiece !== type)
          continue;
        to = from + PAWN_OFFSETS[us][0];
        if (!this._board[to]) {
          addMove(moves, us, from, to, PAWN);
          to = from + PAWN_OFFSETS[us][1];
          if (SECOND_RANK[us] === rank(from) && !this._board[to]) {
            addMove(moves, us, from, to, PAWN, void 0, BITS.BIG_PAWN);
          }
        }
        for (let j = 2; j < 4; j++) {
          to = from + PAWN_OFFSETS[us][j];
          if (to & 136)
            continue;
          if (this._board[to]?.color === them) {
            addMove(moves, us, from, to, PAWN, this._board[to].type, BITS.CAPTURE);
          } else if (to === this._epSquare) {
            addMove(moves, us, from, to, PAWN, PAWN, BITS.EP_CAPTURE);
          }
        }
      } else {
        if (forPiece && forPiece !== type)
          continue;
        for (let j = 0, len = PIECE_OFFSETS[type].length; j < len; j++) {
          const offset = PIECE_OFFSETS[type][j];
          to = from;
          while (true) {
            to += offset;
            if (to & 136)
              break;
            if (!this._board[to]) {
              addMove(moves, us, from, to, type);
            } else {
              if (this._board[to].color === us)
                break;
              addMove(moves, us, from, to, type, this._board[to].type, BITS.CAPTURE);
              break;
            }
            if (type === KNIGHT || type === KING)
              break;
          }
        }
      }
    }
    if (forPiece === void 0 || forPiece === KING) {
      if (!singleSquare || lastSquare === this._kings[us]) {
        if (this._castling[us] & BITS.KSIDE_CASTLE) {
          const castlingFrom = this._kings[us];
          const castlingTo = castlingFrom + 2;
          if (!this._board[castlingFrom + 1] && !this._board[castlingTo] && !this._attacked(them, this._kings[us]) && !this._attacked(them, castlingFrom + 1) && !this._attacked(them, castlingTo)) {
            addMove(moves, us, this._kings[us], castlingTo, KING, void 0, BITS.KSIDE_CASTLE);
          }
        }
        if (this._castling[us] & BITS.QSIDE_CASTLE) {
          const castlingFrom = this._kings[us];
          const castlingTo = castlingFrom - 2;
          if (!this._board[castlingFrom - 1] && !this._board[castlingFrom - 2] && !this._board[castlingFrom - 3] && !this._attacked(them, this._kings[us]) && !this._attacked(them, castlingFrom - 1) && !this._attacked(them, castlingTo)) {
            addMove(moves, us, this._kings[us], castlingTo, KING, void 0, BITS.QSIDE_CASTLE);
          }
        }
      }
    }
    if (!legal || this._kings[us] === -1) {
      return moves;
    }
    const legalMoves = [];
    for (let i = 0, len = moves.length; i < len; i++) {
      this._makeMove(moves[i]);
      if (!this._isKingAttacked(us)) {
        legalMoves.push(moves[i]);
      }
      this._undoMove();
    }
    return legalMoves;
  }
  move(move, { strict = false } = {}) {
    let moveObj = null;
    if (typeof move === "string") {
      moveObj = this._moveFromSan(move, strict);
    } else if (move === null) {
      moveObj = this._moveFromSan(SAN_NULLMOVE, strict);
    } else if (typeof move === "object") {
      const moves = this._moves();
      for (let i = 0, len = moves.length; i < len; i++) {
        if (move.from === algebraic(moves[i].from) && move.to === algebraic(moves[i].to) && (!("promotion" in moves[i]) || move.promotion === moves[i].promotion)) {
          moveObj = moves[i];
          break;
        }
      }
    }
    if (!moveObj) {
      if (typeof move === "string") {
        throw new Error(`Invalid move: ${move}`);
      } else {
        throw new Error(`Invalid move: ${JSON.stringify(move)}`);
      }
    }
    if (this.isCheck() && moveObj.flags & BITS.NULL_MOVE) {
      throw new Error("Null move not allowed when in check");
    }
    const prettyMove = new Move(this, moveObj);
    this._makeMove(moveObj);
    this._incPositionCount();
    return prettyMove;
  }
  _push(move) {
    this._history.push({
      move,
      kings: { b: this._kings.b, w: this._kings.w },
      turn: this._turn,
      castling: { b: this._castling.b, w: this._castling.w },
      epSquare: this._epSquare,
      halfMoves: this._halfMoves,
      moveNumber: this._moveNumber
    });
  }
  _movePiece(from, to) {
    this._hash ^= this._pieceKey(from);
    this._board[to] = this._board[from];
    delete this._board[from];
    this._hash ^= this._pieceKey(to);
  }
  _makeMove(move) {
    const us = this._turn;
    const them = swapColor(us);
    this._push(move);
    if (move.flags & BITS.NULL_MOVE) {
      if (us === BLACK) {
        this._moveNumber++;
      }
      this._halfMoves++;
      this._turn = them;
      this._epSquare = EMPTY;
      return;
    }
    this._hash ^= this._epKey();
    this._hash ^= this._castlingKey();
    if (move.captured) {
      this._hash ^= this._pieceKey(move.to);
    }
    this._movePiece(move.from, move.to);
    if (move.flags & BITS.EP_CAPTURE) {
      if (this._turn === BLACK) {
        this._clear(move.to - 16);
      } else {
        this._clear(move.to + 16);
      }
    }
    if (move.promotion) {
      this._clear(move.to);
      this._set(move.to, { type: move.promotion, color: us });
    }
    if (this._board[move.to].type === KING) {
      this._kings[us] = move.to;
      if (move.flags & BITS.KSIDE_CASTLE) {
        const castlingTo = move.to - 1;
        const castlingFrom = move.to + 1;
        this._movePiece(castlingFrom, castlingTo);
      } else if (move.flags & BITS.QSIDE_CASTLE) {
        const castlingTo = move.to + 1;
        const castlingFrom = move.to - 2;
        this._movePiece(castlingFrom, castlingTo);
      }
      this._castling[us] = 0;
    }
    if (this._castling[us]) {
      for (let i = 0, len = ROOKS[us].length; i < len; i++) {
        if (move.from === ROOKS[us][i].square && this._castling[us] & ROOKS[us][i].flag) {
          this._castling[us] ^= ROOKS[us][i].flag;
          break;
        }
      }
    }
    if (this._castling[them]) {
      for (let i = 0, len = ROOKS[them].length; i < len; i++) {
        if (move.to === ROOKS[them][i].square && this._castling[them] & ROOKS[them][i].flag) {
          this._castling[them] ^= ROOKS[them][i].flag;
          break;
        }
      }
    }
    this._hash ^= this._castlingKey();
    if (move.flags & BITS.BIG_PAWN) {
      let epSquare;
      if (us === BLACK) {
        epSquare = move.to - 16;
      } else {
        epSquare = move.to + 16;
      }
      if (!(move.to - 1 & 136) && this._board[move.to - 1]?.type === PAWN && this._board[move.to - 1]?.color === them || !(move.to + 1 & 136) && this._board[move.to + 1]?.type === PAWN && this._board[move.to + 1]?.color === them) {
        this._epSquare = epSquare;
        this._hash ^= this._epKey();
      } else {
        this._epSquare = EMPTY;
      }
    } else {
      this._epSquare = EMPTY;
    }
    if (move.piece === PAWN) {
      this._halfMoves = 0;
    } else if (move.flags & (BITS.CAPTURE | BITS.EP_CAPTURE)) {
      this._halfMoves = 0;
    } else {
      this._halfMoves++;
    }
    if (us === BLACK) {
      this._moveNumber++;
    }
    this._turn = them;
    this._hash ^= SIDE_KEY;
  }
  undo() {
    const hash = this._hash;
    const move = this._undoMove();
    if (move) {
      const prettyMove = new Move(this, move);
      this._decPositionCount(hash);
      return prettyMove;
    }
    return null;
  }
  _undoMove() {
    const old = this._history.pop();
    if (old === void 0) {
      return null;
    }
    this._hash ^= this._epKey();
    this._hash ^= this._castlingKey();
    const move = old.move;
    this._kings = old.kings;
    this._turn = old.turn;
    this._castling = old.castling;
    this._epSquare = old.epSquare;
    this._halfMoves = old.halfMoves;
    this._moveNumber = old.moveNumber;
    this._hash ^= this._epKey();
    this._hash ^= this._castlingKey();
    this._hash ^= SIDE_KEY;
    const us = this._turn;
    const them = swapColor(us);
    if (move.flags & BITS.NULL_MOVE) {
      return move;
    }
    this._movePiece(move.to, move.from);
    if (move.piece) {
      this._clear(move.from);
      this._set(move.from, { type: move.piece, color: us });
    }
    if (move.captured) {
      if (move.flags & BITS.EP_CAPTURE) {
        let index;
        if (us === BLACK) {
          index = move.to - 16;
        } else {
          index = move.to + 16;
        }
        this._set(index, { type: PAWN, color: them });
      } else {
        this._set(move.to, { type: move.captured, color: them });
      }
    }
    if (move.flags & (BITS.KSIDE_CASTLE | BITS.QSIDE_CASTLE)) {
      let castlingTo, castlingFrom;
      if (move.flags & BITS.KSIDE_CASTLE) {
        castlingTo = move.to + 1;
        castlingFrom = move.to - 1;
      } else {
        castlingTo = move.to - 2;
        castlingFrom = move.to + 1;
      }
      this._movePiece(castlingFrom, castlingTo);
    }
    return move;
  }
  pgn({ newline = "\n", maxWidth = 0 } = {}) {
    const result = [];
    let headerExists = false;
    for (const i in this._header) {
      const headerTag = this._header[i];
      if (headerTag)
        result.push(`[${i} "${this._header[i]}"]` + newline);
      headerExists = true;
    }
    if (headerExists && this._history.length) {
      result.push(newline);
    }
    const appendComment = (moveString2) => {
      const comment = this._comments[this.fen()];
      if (typeof comment !== "undefined") {
        const delimiter = moveString2.length > 0 ? " " : "";
        moveString2 = `${moveString2}${delimiter}{${comment}}`;
      }
      return moveString2;
    };
    const reversedHistory = [];
    while (this._history.length > 0) {
      reversedHistory.push(this._undoMove());
    }
    const moves = [];
    let moveString = "";
    if (reversedHistory.length === 0) {
      moves.push(appendComment(""));
    }
    while (reversedHistory.length > 0) {
      moveString = appendComment(moveString);
      const move = reversedHistory.pop();
      if (!move) {
        break;
      }
      if (!this._history.length && move.color === "b") {
        const prefix = `${this._moveNumber}. ...`;
        moveString = moveString ? `${moveString} ${prefix}` : prefix;
      } else if (move.color === "w") {
        if (moveString.length) {
          moves.push(moveString);
        }
        moveString = this._moveNumber + ".";
      }
      moveString = moveString + " " + this._moveToSan(move, this._moves({ legal: true }));
      this._makeMove(move);
    }
    if (moveString.length) {
      moves.push(appendComment(moveString));
    }
    moves.push(this._header.Result || "*");
    if (maxWidth === 0) {
      return result.join("") + moves.join(" ");
    }
    const strip = function() {
      if (result.length > 0 && result[result.length - 1] === " ") {
        result.pop();
        return true;
      }
      return false;
    };
    const wrapComment = function(width, move) {
      for (const token of move.split(" ")) {
        if (!token) {
          continue;
        }
        if (width + token.length > maxWidth) {
          while (strip()) {
            width--;
          }
          result.push(newline);
          width = 0;
        }
        result.push(token);
        width += token.length;
        result.push(" ");
        width++;
      }
      if (strip()) {
        width--;
      }
      return width;
    };
    let currentWidth = 0;
    for (let i = 0; i < moves.length; i++) {
      if (currentWidth + moves[i].length > maxWidth) {
        if (moves[i].includes("{")) {
          currentWidth = wrapComment(currentWidth, moves[i]);
          continue;
        }
      }
      if (currentWidth + moves[i].length > maxWidth && i !== 0) {
        if (result[result.length - 1] === " ") {
          result.pop();
        }
        result.push(newline);
        currentWidth = 0;
      } else if (i !== 0) {
        result.push(" ");
        currentWidth++;
      }
      result.push(moves[i]);
      currentWidth += moves[i].length;
    }
    return result.join("");
  }
  /**
   * @deprecated Use `setHeader` and `getHeaders` instead. This method will return null header tags (which is not what you want)
   */
  header(...args) {
    for (let i = 0; i < args.length; i += 2) {
      if (typeof args[i] === "string" && typeof args[i + 1] === "string") {
        this._header[args[i]] = args[i + 1];
      }
    }
    return this._header;
  }
  // TODO: value validation per spec
  setHeader(key, value) {
    this._header[key] = value ?? SEVEN_TAG_ROSTER[key] ?? null;
    return this.getHeaders();
  }
  removeHeader(key) {
    if (key in this._header) {
      this._header[key] = SEVEN_TAG_ROSTER[key] || null;
      return true;
    }
    return false;
  }
  // return only non-null headers (omit placemarker nulls)
  getHeaders() {
    const nonNullHeaders = {};
    for (const [key, value] of Object.entries(this._header)) {
      if (value !== null) {
        nonNullHeaders[key] = value;
      }
    }
    return nonNullHeaders;
  }
  loadPgn(pgn2, { strict = false, newlineChar = "\r?\n" } = {}) {
    if (newlineChar !== "\r?\n") {
      pgn2 = pgn2.replace(new RegExp(newlineChar, "g"), "\n");
    }
    const parsedPgn = peg$parse(pgn2);
    this.reset();
    const headers = parsedPgn.headers;
    let fen = "";
    for (const key in headers) {
      if (key.toLowerCase() === "fen") {
        fen = headers[key];
      }
      this.header(key, headers[key]);
    }
    if (!strict) {
      if (fen) {
        this.load(fen, { preserveHeaders: true });
      }
    } else {
      if (headers["SetUp"] === "1") {
        if (!("FEN" in headers)) {
          throw new Error("Invalid PGN: FEN tag must be supplied with SetUp tag");
        }
        this.load(headers["FEN"], { preserveHeaders: true });
      }
    }
    let node2 = parsedPgn.root;
    while (node2) {
      if (node2.move) {
        const move = this._moveFromSan(node2.move, strict);
        if (move == null) {
          throw new Error(`Invalid move in PGN: ${node2.move}`);
        } else {
          this._makeMove(move);
          this._incPositionCount();
        }
      }
      if (node2.comment !== void 0) {
        this._comments[this.fen()] = node2.comment;
      }
      node2 = node2.variations[0];
    }
    const result = parsedPgn.result;
    if (result && Object.keys(this._header).length && this._header["Result"] !== result) {
      this.setHeader("Result", result);
    }
  }
  /*
   * Convert a move from 0x88 coordinates to Standard Algebraic Notation
   * (SAN)
   *
   * @param {boolean} strict Use the strict SAN parser. It will throw errors
   * on overly disambiguated moves (see below):
   *
   * r1bqkbnr/ppp2ppp/2n5/1B1pP3/4P3/8/PPPP2PP/RNBQK1NR b KQkq - 2 4
   * 4. ... Nge7 is overly disambiguated because the knight on c6 is pinned
   * 4. ... Ne7 is technically the valid SAN
   */
  _moveToSan(move, moves) {
    let output = "";
    if (move.flags & BITS.KSIDE_CASTLE) {
      output = "O-O";
    } else if (move.flags & BITS.QSIDE_CASTLE) {
      output = "O-O-O";
    } else if (move.flags & BITS.NULL_MOVE) {
      return SAN_NULLMOVE;
    } else {
      if (move.piece !== PAWN) {
        const disambiguator = getDisambiguator(move, moves);
        output += move.piece.toUpperCase() + disambiguator;
      }
      if (move.flags & (BITS.CAPTURE | BITS.EP_CAPTURE)) {
        if (move.piece === PAWN) {
          output += algebraic(move.from)[0];
        }
        output += "x";
      }
      output += algebraic(move.to);
      if (move.promotion) {
        output += "=" + move.promotion.toUpperCase();
      }
    }
    this._makeMove(move);
    if (this.isCheck()) {
      if (this.isCheckmate()) {
        output += "#";
      } else {
        output += "+";
      }
    }
    this._undoMove();
    return output;
  }
  // convert a move from Standard Algebraic Notation (SAN) to 0x88 coordinates
  _moveFromSan(move, strict = false) {
    let cleanMove = strippedSan(move);
    if (!strict) {
      if (cleanMove === "0-0") {
        cleanMove = "O-O";
      } else if (cleanMove === "0-0-0") {
        cleanMove = "O-O-O";
      }
    }
    if (cleanMove == SAN_NULLMOVE) {
      const res = {
        color: this._turn,
        from: 0,
        to: 0,
        piece: "k",
        flags: BITS.NULL_MOVE
      };
      return res;
    }
    let pieceType = inferPieceType(cleanMove);
    let moves = this._moves({ legal: true, piece: pieceType });
    for (let i = 0, len = moves.length; i < len; i++) {
      if (cleanMove === strippedSan(this._moveToSan(moves[i], moves))) {
        return moves[i];
      }
    }
    if (strict) {
      return null;
    }
    let piece = void 0;
    let matches = void 0;
    let from = void 0;
    let to = void 0;
    let promotion = void 0;
    let overlyDisambiguated = false;
    matches = cleanMove.match(/([pnbrqkPNBRQK])?([a-h][1-8])x?-?([a-h][1-8])([qrbnQRBN])?/);
    if (matches) {
      piece = matches[1];
      from = matches[2];
      to = matches[3];
      promotion = matches[4];
      if (from.length == 1) {
        overlyDisambiguated = true;
      }
    } else {
      matches = cleanMove.match(/([pnbrqkPNBRQK])?([a-h]?[1-8]?)x?-?([a-h][1-8])([qrbnQRBN])?/);
      if (matches) {
        piece = matches[1];
        from = matches[2];
        to = matches[3];
        promotion = matches[4];
        if (from.length == 1) {
          overlyDisambiguated = true;
        }
      }
    }
    pieceType = inferPieceType(cleanMove);
    moves = this._moves({
      legal: true,
      piece: piece ? piece : pieceType
    });
    if (!to) {
      return null;
    }
    for (let i = 0, len = moves.length; i < len; i++) {
      if (!from) {
        if (cleanMove === strippedSan(this._moveToSan(moves[i], moves)).replace("x", "")) {
          return moves[i];
        }
      } else if ((!piece || piece.toLowerCase() == moves[i].piece) && Ox88[from] == moves[i].from && Ox88[to] == moves[i].to && (!promotion || promotion.toLowerCase() == moves[i].promotion)) {
        return moves[i];
      } else if (overlyDisambiguated) {
        const square = algebraic(moves[i].from);
        if ((!piece || piece.toLowerCase() == moves[i].piece) && Ox88[to] == moves[i].to && (from == square[0] || from == square[1]) && (!promotion || promotion.toLowerCase() == moves[i].promotion)) {
          return moves[i];
        }
      }
    }
    return null;
  }
  ascii() {
    let s = "   +------------------------+\n";
    for (let i = Ox88.a8; i <= Ox88.h1; i++) {
      if (file(i) === 0) {
        s += " " + "87654321"[rank(i)] + " |";
      }
      if (this._board[i]) {
        const piece = this._board[i].type;
        const color = this._board[i].color;
        const symbol = color === WHITE ? piece.toUpperCase() : piece.toLowerCase();
        s += " " + symbol + " ";
      } else {
        s += " . ";
      }
      if (i + 1 & 136) {
        s += "|\n";
        i += 8;
      }
    }
    s += "   +------------------------+\n";
    s += "     a  b  c  d  e  f  g  h";
    return s;
  }
  perft(depth) {
    const moves = this._moves({ legal: false });
    let nodes = 0;
    const color = this._turn;
    for (let i = 0, len = moves.length; i < len; i++) {
      this._makeMove(moves[i]);
      if (!this._isKingAttacked(color)) {
        if (depth - 1 > 0) {
          nodes += this.perft(depth - 1);
        } else {
          nodes++;
        }
      }
      this._undoMove();
    }
    return nodes;
  }
  setTurn(color) {
    if (this._turn == color) {
      return false;
    }
    this.move("--");
    return true;
  }
  turn() {
    return this._turn;
  }
  board() {
    const output = [];
    let row = [];
    for (let i = Ox88.a8; i <= Ox88.h1; i++) {
      if (this._board[i] == null) {
        row.push(null);
      } else {
        row.push({
          square: algebraic(i),
          type: this._board[i].type,
          color: this._board[i].color
        });
      }
      if (i + 1 & 136) {
        output.push(row);
        row = [];
        i += 8;
      }
    }
    return output;
  }
  squareColor(square) {
    if (square in Ox88) {
      const sq = Ox88[square];
      return (rank(sq) + file(sq)) % 2 === 0 ? "light" : "dark";
    }
    return null;
  }
  history({ verbose = false } = {}) {
    const reversedHistory = [];
    const moveHistory = [];
    while (this._history.length > 0) {
      reversedHistory.push(this._undoMove());
    }
    while (true) {
      const move = reversedHistory.pop();
      if (!move) {
        break;
      }
      if (verbose) {
        moveHistory.push(new Move(this, move));
      } else {
        moveHistory.push(this._moveToSan(move, this._moves()));
      }
      this._makeMove(move);
    }
    return moveHistory;
  }
  /*
   * Keeps track of position occurrence counts for the purpose of repetition
   * checking. Old positions are removed from the map if their counts are reduced to 0.
   */
  _getPositionCount(hash) {
    return this._positionCount.get(hash) ?? 0;
  }
  _incPositionCount() {
    this._positionCount.set(this._hash, (this._positionCount.get(this._hash) ?? 0) + 1);
  }
  _decPositionCount(hash) {
    const currentCount = this._positionCount.get(hash) ?? 0;
    if (currentCount === 1) {
      this._positionCount.delete(hash);
    } else {
      this._positionCount.set(hash, currentCount - 1);
    }
  }
  _pruneComments() {
    const reversedHistory = [];
    const currentComments = {};
    const copyComment = (fen) => {
      if (fen in this._comments) {
        currentComments[fen] = this._comments[fen];
      }
    };
    while (this._history.length > 0) {
      reversedHistory.push(this._undoMove());
    }
    copyComment(this.fen());
    while (true) {
      const move = reversedHistory.pop();
      if (!move) {
        break;
      }
      this._makeMove(move);
      copyComment(this.fen());
    }
    this._comments = currentComments;
  }
  getComment() {
    return this._comments[this.fen()];
  }
  setComment(comment) {
    this._comments[this.fen()] = comment.replace("{", "[").replace("}", "]");
  }
  /**
   * @deprecated Renamed to `removeComment` for consistency
   */
  deleteComment() {
    return this.removeComment();
  }
  removeComment() {
    const comment = this._comments[this.fen()];
    delete this._comments[this.fen()];
    return comment;
  }
  getComments() {
    this._pruneComments();
    return Object.keys(this._comments).map((fen) => {
      return { fen, comment: this._comments[fen] };
    });
  }
  /**
   * @deprecated Renamed to `removeComments` for consistency
   */
  deleteComments() {
    return this.removeComments();
  }
  removeComments() {
    this._pruneComments();
    return Object.keys(this._comments).map((fen) => {
      const comment = this._comments[fen];
      delete this._comments[fen];
      return { fen, comment };
    });
  }
  setCastlingRights(color, rights) {
    for (const side of [KING, QUEEN]) {
      if (rights[side] !== void 0) {
        if (rights[side]) {
          this._castling[color] |= SIDES[side];
        } else {
          this._castling[color] &= ~SIDES[side];
        }
      }
    }
    this._updateCastlingRights();
    const result = this.getCastlingRights(color);
    return (rights[KING] === void 0 || rights[KING] === result[KING]) && (rights[QUEEN] === void 0 || rights[QUEEN] === result[QUEEN]);
  }
  getCastlingRights(color) {
    return {
      [KING]: (this._castling[color] & SIDES[KING]) !== 0,
      [QUEEN]: (this._castling[color] & SIDES[QUEEN]) !== 0
    };
  }
  moveNumber() {
    return this._moveNumber;
  }
};

// node_modules/@capgo/capacitor-inappbrowser/dist/esm/index.js
init_dist();

// node_modules/@capgo/capacitor-inappbrowser/dist/esm/definitions.js
var BackgroundColor;
(function(BackgroundColor2) {
  BackgroundColor2["WHITE"] = "white";
  BackgroundColor2["BLACK"] = "black";
})(BackgroundColor || (BackgroundColor = {}));
var ToolBarType;
(function(ToolBarType2) {
  ToolBarType2["ACTIVITY"] = "activity";
  ToolBarType2["COMPACT"] = "compact";
  ToolBarType2["NAVIGATION"] = "navigation";
  ToolBarType2["BLANK"] = "blank";
})(ToolBarType || (ToolBarType = {}));
var InvisibilityMode;
(function(InvisibilityMode2) {
  InvisibilityMode2["AWARE"] = "AWARE";
  InvisibilityMode2["FAKE_VISIBLE"] = "FAKE_VISIBLE";
})(InvisibilityMode || (InvisibilityMode = {}));
var CloseAction;
(function(CloseAction2) {
  CloseAction2["CLOSE"] = "close";
  CloseAction2["HIDE"] = "hide";
})(CloseAction || (CloseAction = {}));

// node_modules/@capgo/capacitor-inappbrowser/dist/esm/index.js
var CAPGO_PLUGIN_NAME = "CapgoInAppBrowser";
var PREVIOUS_PLUGIN_NAME = "InAppBrowser";
function resolvePluginName() {
  if (!Capacitor.isNativePlatform()) {
    return CAPGO_PLUGIN_NAME;
  }
  if (Capacitor.isPluginAvailable(CAPGO_PLUGIN_NAME)) {
    return CAPGO_PLUGIN_NAME;
  }
  if (Capacitor.isPluginAvailable(PREVIOUS_PLUGIN_NAME)) {
    return PREVIOUS_PLUGIN_NAME;
  }
  console.warn(`[InAppBrowser] Neither '${CAPGO_PLUGIN_NAME}' nor '${PREVIOUS_PLUGIN_NAME}' native plugin detected. Ensure @capgo/capacitor-inappbrowser native code is installed.`);
  return CAPGO_PLUGIN_NAME;
}
var inAppBrowserImplementations = {
  web: () => Promise.resolve().then(() => (init_web(), web_exports)).then((m) => new m.InAppBrowserWeb())
};
var InAppBrowser = registerPlugin(resolvePluginName(), inAppBrowserImplementations);

// data/puzzleLoader.js
var activeLibrary = null;
function getPuzzleLibrary() {
  if (!activeLibrary) {
    throw new Error("No puzzle library loaded. Set an in-memory or SQLite-backed puzzle library first.");
  }
  return activeLibrary;
}
function filterPuzzles(query, library = activeLibrary) {
  if (!library || typeof library.filter !== "function") {
    throw new Error("No puzzle library loaded. Set a puzzle library before filterPuzzles().");
  }
  return library.filter(query);
}

// data/themeMapping.js
var WEAKNESS_CATEGORIES = Object.freeze([
  "tactical",
  "king_safety",
  "pawn_structure",
  "piece_activity",
  "positional_judgment",
  "endgame_technique",
  "practical_time"
]);
var STEP_BUCKETS = Object.freeze({
  short: Object.freeze([2, 6]),
  long: Object.freeze([8, 12])
});
var THEME_TO_WEAKNESS = Object.freeze({
  advancedPawn: "pawn_structure",
  advantage: "positional_judgment",
  anastasiaMate: "tactical",
  arabianMate: "tactical",
  attackingF2F7: "king_safety",
  attraction: "tactical",
  backRankMate: "tactical",
  balestraMate: "tactical",
  bishopEndgame: "endgame_technique",
  blindSwineMate: "tactical",
  bodenMate: "tactical",
  capturingDefender: "tactical",
  castling: "king_safety",
  checkFirst: "tactical",
  clearance: "piece_activity",
  collinearMove: "piece_activity",
  cornerMate: "tactical",
  crushing: "positional_judgment",
  defensiveMove: "positional_judgment",
  deflection: "tactical",
  discoveredAttack: "tactical",
  discoveredCheck: "tactical",
  doubleBishopMate: "tactical",
  doubleCheck: "king_safety",
  dovetailMate: "tactical",
  endgame: "endgame_technique",
  enPassant: "pawn_structure",
  epauletteMate: "tactical",
  equality: "positional_judgment",
  exposedKing: "king_safety",
  fork: "tactical",
  hangingPiece: "tactical",
  hookMate: "tactical",
  interference: "tactical",
  intermezzo: "tactical",
  killBoxMate: "tactical",
  kingsideAttack: "king_safety",
  knightEndgame: "endgame_technique",
  mate: "tactical",
  mateIn1: "tactical",
  mateIn2: "tactical",
  mateIn3: "tactical",
  mateIn4: "tactical",
  mateIn5: "tactical",
  middlegame: "positional_judgment",
  operaMate: "tactical",
  opening: "positional_judgment",
  pawnEndgame: "endgame_technique",
  pillsburysMate: "tactical",
  pin: "tactical",
  promotion: "pawn_structure",
  queenEndgame: "endgame_technique",
  queenRookEndgame: "endgame_technique",
  queensideAttack: "king_safety",
  quietMove: "positional_judgment",
  rookEndgame: "endgame_technique",
  sacrifice: "tactical",
  skewer: "tactical",
  smotheredMate: "tactical",
  swallowstailMate: "tactical",
  trappedPiece: "piece_activity",
  triangleMate: "tactical",
  underPromotion: "pawn_structure",
  vukovicMate: "tactical",
  xRayAttack: "piece_activity",
  zugzwang: "endgame_technique"
});
var NON_WEAKNESS_METADATA_THEMES = Object.freeze([
  "master",
  "masterVsMaster",
  "superGM",
  "mix",
  "oneMove",
  "short",
  "long",
  "veryLong"
]);
var WEAKNESS_TO_THEMES = Object.freeze(
  WEAKNESS_CATEGORIES.reduce((acc, category) => {
    acc[category] = Object.freeze(
      Object.entries(THEME_TO_WEAKNESS).filter(([, mappedCategory]) => mappedCategory === category).map(([theme]) => theme)
    );
    return acc;
  }, {})
);
function getThemeTagsForWeakness(weaknessCategory) {
  if (!WEAKNESS_CATEGORIES.includes(weaknessCategory)) {
    throw new RangeError(`Unknown weakness category: ${weaknessCategory}`);
  }
  return WEAKNESS_TO_THEMES[weaknessCategory];
}
function pickOne(puzzles, random) {
  if (!puzzles.length) return null;
  const index = Math.min(puzzles.length - 1, Math.floor(random() * puzzles.length));
  return puzzles[index];
}
function sampleForQuery(library, query, random) {
  if (typeof library?.sample === "function") return library.sample(query, random);
  return pickOne(filterPuzzles(query, library), random);
}
function longestForThemes(library, themeTags) {
  if (typeof library?.findLongest === "function") return library.findLongest({ themeTags });
  return filterPuzzles(
    { themeTags, stepRange: [0, Number.POSITIVE_INFINITY] },
    library
  ).reduce((longest, puzzle) => {
    if (!longest || puzzle.stepCount > longest.stepCount) return puzzle;
    return longest;
  }, null);
}
function getOneForBucket(weaknessCategory, bucket, library, random) {
  const stepRange = STEP_BUCKETS[bucket];
  if (!stepRange) throw new RangeError(`Unknown step bucket: ${bucket}`);
  const themeTags = getThemeTagsForWeakness(weaknessCategory);
  if (themeTags.length === 0) {
    throw new Error(`No seed-puzzle themes are mapped for weakness ${weaknessCategory}.`);
  }
  const puzzle = sampleForQuery(library, { themeTags, stepRange }, random);
  if (puzzle) return puzzle;
  if (bucket === "long") {
    const fallback = longestForThemes(library, themeTags);
    if (fallback) {
      return Object.freeze({
        ...fallback,
        bucketDowngraded: true
      });
    }
  }
  throw new Error(`No ${bucket} puzzle available for weakness ${weaknessCategory}.`);
}
function getPuzzlesForWeakness(weaknessCategory, stepBucket = "start-slow", { library = getPuzzleLibrary(), random = Math.random } = {}) {
  if (!WEAKNESS_CATEGORIES.includes(weaknessCategory)) {
    throw new RangeError(`Unknown weakness category: ${weaknessCategory}`);
  }
  if (stepBucket === "short" || stepBucket === "long") {
    return [getOneForBucket(weaknessCategory, stepBucket, library, random)];
  }
  if (stepBucket !== "start-slow" && stepBucket !== null && stepBucket !== void 0) {
    throw new RangeError(`Unknown step bucket: ${stepBucket}`);
  }
  return [
    getOneForBucket(weaknessCategory, "short", library, random),
    getOneForBucket(weaknessCategory, "long", library, random)
  ];
}

// engine/stockfishWorker.js
var DEFAULT_ANALYSIS_DEPTH = 16;
var DEFAULT_PLAY_DEPTH = 12;
var MATE_SCORE_CP = 1e5;
var PERSONAS = Object.freeze({
  kitten: Object.freeze({
    id: "kitten",
    name: "Kitten",
    avatar: "\u{1F431}",
    theme: "orange-tabby",
    targetElo: 800,
    uciLimitStrength: false,
    skillLevel: 0,
    depth: 1,
    description: "Playful and makes frequent blunders (~800 Elo)"
  }),
  tabby: Object.freeze({
    id: "tabby",
    name: "Tabby",
    avatar: "\u{1F431}",
    theme: "orange-tabby",
    targetElo: 1200,
    uciLimitStrength: false,
    skillLevel: 3,
    depth: 4,
    description: "Casual club player with basic tactical awareness (~1200 Elo)"
  }),
  alley_cat: Object.freeze({
    id: "alley_cat",
    name: "Alley Cat",
    avatar: "\u{1F408}",
    theme: "calico",
    targetElo: 1500,
    uciLimitStrength: true,
    uciElo: 1500,
    depth: 8,
    description: "Solid intermediate player with sharp eyes (~1500 Elo)"
  }),
  hunter: Object.freeze({
    id: "hunter",
    name: "Hunter",
    avatar: "\u{1F406}",
    theme: "fox",
    targetElo: 1800,
    uciLimitStrength: true,
    uciElo: 1800,
    depth: 12,
    description: "Dangerous attacking player with strong fundamentals (~1800 Elo)"
  }),
  panther: Object.freeze({
    id: "panther",
    name: "Panther",
    avatar: "\u{1F406}",
    theme: "black-cat",
    targetElo: 2100,
    uciLimitStrength: true,
    uciElo: 2100,
    depth: 16,
    description: "Master-level tactician who pounces on any inaccuracy (~2100 Elo)"
  }),
  apex_tiger: Object.freeze({
    id: "apex_tiger",
    name: "Apex Tiger",
    avatar: "\u{1F405}",
    theme: "panda",
    targetElo: 2800,
    uciLimitStrength: false,
    skillLevel: 20,
    depth: 20,
    description: "Uncapped Stockfish engine at maximum strength (~2800+ Elo)"
  })
});
function resolvePersona(config) {
  if (!config) return PERSONAS.tabby;
  if (typeof config === "string") {
    const key = config.toLowerCase().replace(/[-\s]/g, "_");
    return PERSONAS[key] ?? PERSONAS.tabby;
  }
  if (typeof config === "object" && config.id && PERSONAS[config.id]) {
    return PERSONAS[config.id];
  }
  return config;
}
function normalizeWorkerMessage(event) {
  const value = event?.data ?? event;
  return String(value ?? "").trim();
}
function parseInfoLine(line) {
  if (!line.startsWith("info ")) return null;
  const depthMatch = line.match(/\bdepth\s+(\d+)/);
  const cpMatch = line.match(/\bscore\s+cp\s+(-?\d+)/);
  const mateMatch = line.match(/\bscore\s+mate\s+(-?\d+)/);
  const pvMatch = line.match(/\bpv\s+(.+)$/);
  let evalCp = null;
  let isMateScore = false;
  if (cpMatch) {
    evalCp = Number.parseInt(cpMatch[1], 10);
  } else if (mateMatch) {
    const mateIn = Number.parseInt(mateMatch[1], 10);
    evalCp = Math.sign(mateIn || 1) * MATE_SCORE_CP;
    isMateScore = true;
  }
  return {
    depth: depthMatch ? Number.parseInt(depthMatch[1], 10) : 0,
    evalCp,
    isMateScore,
    principalVariation: pvMatch ? pvMatch[1].trim().split(/\s+/) : []
  };
}
function defaultWorkerFactory(workerUrl) {
  if (typeof Worker === "undefined") {
    throw new Error("Web Worker is unavailable in this runtime. Provide workerFactory for tests/non-browser runtimes.");
  }
  return new Worker(workerUrl);
}
function defaultWorkerUrl() {
  return new URL("./vendor/stockfish/stockfish.js", import.meta.url);
}
var StockfishWorkerClient = class {
  constructor({
    workerUrl = defaultWorkerUrl(),
    workerFactory = defaultWorkerFactory,
    analysisDepth = DEFAULT_ANALYSIS_DEPTH,
    playDepth = DEFAULT_PLAY_DEPTH,
    commandTimeoutMs = 15e3,
    searchTimeoutMs = 3e4
  } = {}) {
    this.worker = workerFactory(workerUrl);
    this.analysisDepth = analysisDepth;
    this.playDepth = playDepth;
    this.commandTimeoutMs = commandTimeoutMs;
    this.searchTimeoutMs = searchTimeoutMs;
    this.waiters = [];
    this.currentSearch = null;
    this.queue = Promise.resolve();
    this.disposed = false;
    this.failure = null;
    this.readyPromise = null;
    this.engineName = null;
    this.engineAuthor = null;
    this.handleMessage = this.handleMessage.bind(this);
    this.handleError = this.handleError.bind(this);
    this.worker.addEventListener("message", this.handleMessage);
    this.worker.addEventListener?.("error", this.handleError);
  }
  handleError(event) {
    const error = event instanceof Error ? event : new Error(event?.message || "Stockfish worker failed.");
    this.fail(error);
  }
  fail(error) {
    if (!this.failure) this.failure = error;
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(this.failure);
    }
    if (this.currentSearch) {
      clearTimeout(this.currentSearch.timer);
      this.currentSearch.reject(this.failure);
      this.currentSearch = null;
    }
    this.worker.terminate?.();
  }
  handleMessage(event) {
    const line = normalizeWorkerMessage(event);
    if (!line) return;
    if (line.startsWith("id name ")) this.engineName = line.slice("id name ".length);
    if (line.startsWith("id author ")) this.engineAuthor = line.slice("id author ".length);
    for (let i = 0; i < this.waiters.length; i += 1) {
      const waiter = this.waiters[i];
      if (waiter.predicate(line)) {
        this.waiters.splice(i, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(line);
        break;
      }
    }
    if (!this.currentSearch) return;
    const info = parseInfoLine(line);
    if (info && info.depth >= this.currentSearch.depth) {
      this.currentSearch.depth = info.depth;
      if (info.evalCp !== null) {
        this.currentSearch.evalCp = info.evalCp;
        this.currentSearch.isMateScore = info.isMateScore;
      }
      if (info.principalVariation.length) {
        this.currentSearch.principalVariation = info.principalVariation;
      }
      return;
    }
    const bestMoveMatch = line.match(/^bestmove\s+(\S+)/);
    if (bestMoveMatch) {
      const search = this.currentSearch;
      this.currentSearch = null;
      clearTimeout(search.timer);
      const bestMove = bestMoveMatch[1] === "(none)" ? null : bestMoveMatch[1];
      search.resolve({
        bestMove,
        evalCp: search.evalCp,
        isMateScore: search.isMateScore,
        principalVariation: search.principalVariation
      });
    }
  }
  waitFor(predicate, timeoutMs = this.commandTimeoutMs) {
    if (this.disposed) return Promise.reject(new Error("Stockfish worker has been disposed."));
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        this.fail(new Error(`Stockfish command timed out after ${timeoutMs} ms.`));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }
  post(command) {
    if (this.disposed) throw new Error("Stockfish worker has been disposed.");
    if (this.failure) throw this.failure;
    this.worker.postMessage(command);
  }
  async ensureReady() {
    if (!this.readyPromise) {
      this.readyPromise = (async () => {
        const uciOk = this.waitFor((line) => line === "uciok");
        this.post("uci");
        await uciOk;
        await this.syncReady();
      })();
    }
    return this.readyPromise;
  }
  async syncReady() {
    const ready = this.waitFor((line) => line === "readyok");
    this.post("isready");
    await ready;
  }
  enqueue(task) {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => void 0);
    return run;
  }
  async search(fen, command) {
    if (this.currentSearch) {
      throw new Error("A Stockfish search is already active. Searches must be serialized.");
    }
    this.post(`position fen ${fen}`);
    const result = new Promise((resolve, reject) => {
      const search = {
        depth: -1,
        evalCp: null,
        isMateScore: false,
        principalVariation: [],
        resolve,
        reject,
        timer: null
      };
      search.timer = setTimeout(() => {
        if (this.currentSearch !== search) return;
        this.fail(new Error(`Stockfish search timed out after ${this.searchTimeoutMs} ms.`));
      }, this.searchTimeoutMs);
      this.currentSearch = search;
    });
    this.post(command);
    return result;
  }
  analyzePosition(fen, depth = this.analysisDepth) {
    return this.enqueue(async () => {
      await this.ensureReady();
      this.post("setoption name UCI_LimitStrength value false");
      this.post("setoption name Skill Level value 20");
      await this.syncReady();
      return this.search(fen, `go depth ${Math.max(1, Math.trunc(depth))}`);
    });
  }
  playMove(fen, personaOrSkillLevel = 10) {
    return this.enqueue(async () => {
      await this.ensureReady();
      let targetDepth = this.playDepth;
      if (typeof personaOrSkillLevel === "string" && PERSONAS[personaOrSkillLevel.toLowerCase().replace(/[-\s]/g, "_")]) {
        const p = resolvePersona(personaOrSkillLevel);
        targetDepth = p.depth ?? this.playDepth;
        if (p.uciLimitStrength && p.uciElo) {
          this.post("setoption name UCI_LimitStrength value true");
          this.post(`setoption name UCI_Elo value ${Math.trunc(p.uciElo)}`);
        } else {
          this.post("setoption name UCI_LimitStrength value false");
          this.post(`setoption name Skill Level value ${Math.trunc(p.skillLevel ?? 20)}`);
        }
      } else if (typeof personaOrSkillLevel === "object" && personaOrSkillLevel !== null) {
        const p = personaOrSkillLevel;
        targetDepth = p.depth ?? this.playDepth;
        if (p.uciLimitStrength && p.uciElo) {
          this.post("setoption name UCI_LimitStrength value true");
          this.post(`setoption name UCI_Elo value ${Math.trunc(p.uciElo)}`);
        } else {
          this.post("setoption name UCI_LimitStrength value false");
          this.post(`setoption name Skill Level value ${Math.trunc(p.skillLevel ?? 20)}`);
        }
      } else {
        const strength = Number(personaOrSkillLevel);
        if (!Number.isFinite(strength)) {
          throw new TypeError("personaOrSkillLevel must be a persona name, object, or finite number.");
        }
        if (strength >= 0 && strength <= 20) {
          this.post("setoption name UCI_LimitStrength value false");
          this.post(`setoption name Skill Level value ${Math.trunc(strength)}`);
        } else {
          this.post("setoption name UCI_LimitStrength value true");
          this.post(`setoption name UCI_Elo value ${Math.trunc(strength)}`);
        }
      }
      await this.syncReady();
      const result = await this.search(fen, `go depth ${Math.max(1, Math.trunc(targetDepth))}`);
      return result.bestMove;
    });
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.removeEventListener?.("message", this.handleMessage);
    this.worker.removeEventListener?.("error", this.handleError);
    this.worker.terminate?.();
    const error = new Error("Stockfish worker disposed.");
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    if (this.currentSearch) {
      clearTimeout(this.currentSearch.timer);
      this.currentSearch.reject(error);
      this.currentSearch = null;
    }
  }
};
var singletonClient = null;
function configureStockfish(options = {}) {
  singletonClient?.dispose();
  singletonClient = new StockfishWorkerClient(options);
  return singletonClient;
}
function getSingletonClient() {
  if (!singletonClient) singletonClient = new StockfishWorkerClient();
  return singletonClient;
}
function analyzePosition(fen, depth) {
  return getSingletonClient().analyzePosition(fen, depth);
}
function playMove(fen, skillLevel) {
  return getSingletonClient().playMove(fen, skillLevel);
}

// engine/fen.js
var UCI_MOVE_PATTERN = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/;
function applyUciMoveToFen(fen, uciMove) {
  const normalizedFen = String(fen ?? "").trim();
  const normalizedMove = String(uciMove ?? "").trim();
  const match = normalizedMove.match(UCI_MOVE_PATTERN);
  if (!match) {
    throw new Error(`Invalid UCI move: ${uciMove}`);
  }
  let chess2;
  try {
    chess2 = new Chess(normalizedFen);
  } catch (error) {
    throw new Error(`Invalid FEN: ${error.message}`, { cause: error });
  }
  const [, from, to, promotion] = match;
  const move = promotion ? { from, to, promotion } : { from, to };
  try {
    chess2.move(move);
  } catch (error) {
    throw new Error(`Illegal UCI move ${normalizedMove}: ${error.message}`, { cause: error });
  }
  return chess2.fen();
}

// engine/practiceSession.js
var STANDARD_START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
function createDefaultEngine() {
  return {
    analyzePosition,
    playMove
  };
}
function defaultId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `practice-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function normalizeAnalysis(analysis) {
  if (!analysis || typeof analysis !== "object") {
    return { bestMove: null, evalCp: null, principalVariation: [], isMateScore: false };
  }
  return {
    bestMove: analysis.bestMove ?? null,
    evalCp: analysis.evalCp ?? null,
    principalVariation: Array.isArray(analysis.principalVariation) ? analysis.principalVariation : [],
    isMateScore: Boolean(analysis.isMateScore)
  };
}
function getSetupMove(puzzle) {
  const moves = Array.isArray(puzzle?.moves) ? puzzle.moves : String(puzzle?.Moves ?? "").trim().split(/\s+/).filter(Boolean);
  if (!moves.length) {
    throw new Error("A Lichess seed puzzle with Moves[0] setup move is required.");
  }
  return moves[0];
}
function getMotifReadyFen(puzzle) {
  if (!puzzle?.FEN) throw new Error("A seed puzzle with FEN is required.");
  return applyUciMoveToFen(puzzle.FEN, getSetupMove(puzzle));
}
var PracticeSession = class {
  constructor({
    puzzle = null,
    mode = puzzle ? "practice" : "freeplay",
    startFen = null,
    skillLevel = 10,
    persona = "tabby",
    timeControl = "5|0",
    playerColor = "white",
    analysisDepth = 14,
    engine = createDefaultEngine(),
    gameId = defaultId(),
    now = () => (/* @__PURE__ */ new Date()).toISOString()
  } = {}) {
    if (!engine?.analyzePosition || !engine?.playMove) {
      throw new TypeError("engine must provide analyzePosition() and playMove().");
    }
    this.puzzle = puzzle;
    this.mode = mode;
    this.skillLevel = skillLevel;
    this.persona = typeof persona === "object" && persona?.id ? persona.id : persona || "tabby";
    this.timeControl = timeControl;
    this.analysisDepth = analysisDepth;
    this.engine = engine;
    this.gameId = gameId;
    this.now = now;
    if (playerColor === "random") {
      this.playerColor = Math.random() < 0.5 ? "white" : "black";
    } else {
      this.playerColor = playerColor === "black" ? "black" : "white";
    }
    if (puzzle?.FEN) {
      this.startFen = getMotifReadyFen(puzzle);
    } else {
      this.startFen = startFen || STANDARD_START_FEN;
    }
    this.currentFen = this.startFen;
    this.logs = [];
    this.hints = [];
    this.hintCount = 0;
    this.takebackCount = 0;
    this.previewUsed = false;
    this.ended = false;
    this.result = null;
  }
  get nextPlyNumber() {
    return this.logs.length + 1;
  }
  async evaluate(fen) {
    return normalizeAnalysis(await this.engine.analyzePosition(fen, this.analysisDepth));
  }
  makeLog({ plyNumber, fenBefore, movePlayed, beforeAnalysis, afterAnalysis, stockfishResponse = null }) {
    const before = normalizeAnalysis(beforeAnalysis);
    const after = normalizeAnalysis(afterAnalysis);
    return {
      game_id: this.gameId,
      ply_number: plyNumber,
      fen_before: fenBefore,
      move_played: movePlayed,
      eval_cp_before: before.evalCp,
      eval_cp_after: after.evalCp,
      best_move: before.bestMove,
      principal_variation: before.principalVariation.length ? before.principalVariation.join(" ") : null,
      is_mate_score: before.isMateScore || after.isMateScore ? 1 : 0,
      stockfish_response: stockfishResponse,
      timestamp: this.now()
    };
  }
  async playTurn(playerMove) {
    if (this.ended) throw new Error("Practice session has ended.");
    const playerFenBefore = this.currentFen;
    const playerBeforeAnalysis = await this.evaluate(playerFenBefore);
    const playerFenAfter = applyUciMoveToFen(playerFenBefore, playerMove);
    const playerAfterAnalysis = await this.evaluate(playerFenAfter);
    const playerLog = this.makeLog({
      plyNumber: this.nextPlyNumber,
      fenBefore: playerFenBefore,
      movePlayed: playerMove,
      beforeAnalysis: playerBeforeAnalysis,
      afterAnalysis: playerAfterAnalysis
    });
    const engineFenBefore = playerFenAfter;
    const engineBeforeAnalysis = playerAfterAnalysis;
    const engineMove = await this.engine.playMove(engineFenBefore, this.persona ?? this.skillLevel);
    if (!engineMove) {
      this.currentFen = playerFenAfter;
      this.logs.push(playerLog);
      return { playerLog, engineLog: null, currentFen: this.currentFen };
    }
    playerLog.stockfish_response = engineMove;
    const engineFenAfter = applyUciMoveToFen(engineFenBefore, engineMove);
    const engineAfterAnalysis = await this.evaluate(engineFenAfter);
    const engineLog = this.makeLog({
      plyNumber: this.nextPlyNumber + 1,
      fenBefore: engineFenBefore,
      movePlayed: engineMove,
      beforeAnalysis: engineBeforeAnalysis,
      afterAnalysis: engineAfterAnalysis
    });
    this.currentFen = engineFenAfter;
    this.logs.push(playerLog, engineLog);
    return { playerLog, engineLog, currentFen: this.currentFen };
  }
  async playEngineMove() {
    if (this.ended) throw new Error("Practice session has ended.");
    const fenBefore = this.currentFen;
    const beforeAnalysis = await this.evaluate(fenBefore);
    const engineMove = await this.engine.playMove(fenBefore, this.persona ?? this.skillLevel);
    if (!engineMove) return null;
    const fenAfter = applyUciMoveToFen(fenBefore, engineMove);
    const afterAnalysis = await this.evaluate(fenAfter);
    const engineLog = this.makeLog({
      plyNumber: this.nextPlyNumber,
      fenBefore,
      movePlayed: engineMove,
      beforeAnalysis,
      afterAnalysis
    });
    this.currentFen = fenAfter;
    this.logs.push(engineLog);
    return { engineLog, currentFen: this.currentFen };
  }
  takeback() {
    if (this.ended) throw new Error("Cannot take back moves on an ended session.");
    if (this.logs.length === 0) return null;
    const pliesToRemove = Math.min(2, this.logs.length);
    const removedLogs = this.logs.splice(this.logs.length - pliesToRemove, pliesToRemove);
    this.currentFen = removedLogs[0].fen_before;
    this.takebackCount += 1;
    return {
      revertedFen: this.currentFen,
      takebackCount: this.takebackCount,
      removedLogs
    };
  }
  recordHint(tier, detector = null) {
    this.hintCount += 1;
    const log = {
      tier,
      detector,
      fen: this.currentFen,
      timestamp: this.now()
    };
    this.hints.push(log);
    return log;
  }
  recordPreview() {
    this.previewUsed = true;
  }
  resign(color = this.playerColor) {
    this.ended = true;
    this.result = color === "white" ? "0-1" : "1-0";
    return this.summary();
  }
  async offerDraw() {
    if (this.ended) throw new Error("Session is already ended.");
    const analysis = await this.evaluate(this.currentFen);
    const cp = analysis.evalCp;
    if (cp !== null && Math.abs(cp) <= 75 && !analysis.isMateScore) {
      this.ended = true;
      this.result = "1/2-1/2";
      return { accepted: true, result: "1/2-1/2", summary: this.summary() };
    }
    return {
      accepted: false,
      reason: "Engine evaluated position as advantageous and declined the draw."
    };
  }
  computeAssistanceLevel() {
    if (this.hintCount === 0 && this.takebackCount === 0 && !this.previewUsed) {
      return "none";
    }
    if (this.takebackCount > 1) {
      return "full";
    }
    if (this.hintCount > 0 || this.takebackCount === 1) {
      return "hints";
    }
    if (this.previewUsed) {
      return "preview";
    }
    return "full";
  }
  async run(moveProvider, { maxTurns = Number.POSITIVE_INFINITY } = {}) {
    if (typeof moveProvider !== "function") throw new TypeError("moveProvider must be a function.");
    let turns = 0;
    while (!this.ended && turns < maxTurns) {
      const move = await moveProvider({
        fen: this.currentFen,
        logs: [...this.logs],
        turn: turns
      });
      if (!move) break;
      await this.playTurn(move);
      turns += 1;
    }
    return this.summary();
  }
  end(result = null) {
    this.ended = true;
    this.result = result;
    return this.summary();
  }
  summary() {
    return {
      id: this.gameId,
      mode: this.mode,
      seeded_weakness: this.puzzle?.weaknessCategory ?? null,
      seed_puzzle_id: this.puzzle?.PuzzleId ?? null,
      start_fen: this.startFen,
      current_fen: this.currentFen,
      result: this.result,
      player_color: this.playerColor,
      time_control: this.timeControl,
      persona: this.persona,
      assistance_level: this.computeAssistanceLevel(),
      hint_count: this.hintCount,
      takeback_count: this.takebackCount,
      moves: [...this.logs]
    };
  }
};

// core/targeting.js
var PRACTICAL_TIME_ADVICE = "Practical/time is not a puzzle motif. Slow down and use a deliberate pre-move scan before committing.";
function categoryOf(entry) {
  return typeof entry === "string" ? entry : entry?.category;
}
function selectSeedableTarget(rankedWeaknesses, { getPuzzles = getPuzzlesForWeakness, bootstrapCategory = "tactical" } = {}) {
  if (!Array.isArray(rankedWeaknesses)) throw new TypeError("rankedWeaknesses must be an array.");
  const weaknesses = rankedWeaknesses.length > 0 ? rankedWeaknesses : [{ category: bootstrapCategory, bootstrap: true }];
  const skipped = [];
  for (const entry of weaknesses) {
    const category = categoryOf(entry);
    if (!WEAKNESS_CATEGORIES.includes(category)) {
      throw new RangeError(`Unknown weakness category: ${category}`);
    }
    if (category === "practical_time") {
      skipped.push({
        category,
        reason: "non_seedable",
        advice: PRACTICAL_TIME_ADVICE
      });
      continue;
    }
    return {
      weaknessCategory: category,
      puzzles: getPuzzles(category, "start-slow"),
      skipped
    };
  }
  return {
    weaknessCategory: null,
    puzzles: [],
    skipped
  };
}

// core/orchestrator.js
function defaultIdFactory({ puzzle, index }) {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${puzzle.PuzzleId ?? "seed"}-${index}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
var TrainingOrchestrator = class {
  constructor({
    db: db2,
    storage,
    puzzleLibrary,
    engineFactory,
    skillLevel = 10,
    idFactory = defaultIdFactory,
    now = () => (/* @__PURE__ */ new Date()).toISOString()
  }) {
    if (!db2) throw new TypeError("db must be provided.");
    if (!storage || typeof storage !== "object") {
      throw new TypeError(
        'storage adapter must be provided explicitly (e.g. `import * as storage from "../storage/db.js"` on desktop, or `../storage/mobileDb.js` on Capacitor). It is no longer imported by default so this module stays browser-safe.'
      );
    }
    if (!puzzleLibrary?.filter) throw new TypeError("puzzleLibrary must provide filter(query).");
    if (typeof engineFactory !== "function") throw new TypeError("engineFactory must be a function.");
    if (!Number.isInteger(skillLevel) || skillLevel < 0 || skillLevel > 20) {
      throw new RangeError("skillLevel must be an integer from 0 to 20.");
    }
    this.db = db2;
    this.storage = storage;
    this.puzzleLibrary = puzzleLibrary;
    this.engineFactory = engineFactory;
    this.skillLevel = skillLevel;
    this.idFactory = idFactory;
    this.now = now;
    this.queue = [];
    this.sessions = /* @__PURE__ */ new Map();
  }
  setSkillLevel(skillLevel) {
    if (!Number.isInteger(skillLevel) || skillLevel < 0 || skillLevel > 20) {
      throw new RangeError("skillLevel must be an integer from 0 to 20.");
    }
    this.skillLevel = skillLevel;
  }
  async getNextFocus(rankedWeaknesses) {
    const weaknesses = rankedWeaknesses ?? await this.storage.getWeaknessTally(this.db);
    return selectSeedableTarget(weaknesses, {
      getPuzzles: (category, bucket) => getPuzzlesForWeakness(category, bucket, {
        library: this.puzzleLibrary
      })
    });
  }
  async startTargetedSession(rankedWeaknesses) {
    const weaknesses = rankedWeaknesses ?? await this.storage.getWeaknessTally(this.db);
    const unresolvedFocus = await this.getNextFocus(weaknesses);
    const focus = {
      ...unresolvedFocus,
      puzzles: await Promise.all(unresolvedFocus.puzzles ?? [])
    };
    if (!focus.weaknessCategory) return { ...focus, activeSession: null, queued: [] };
    if (focus.puzzles.length !== 2) {
      throw new Error(`Start-slow targeting must return exactly two puzzles; received ${focus.puzzles.length}.`);
    }
    const queued = focus.puzzles.map((puzzle, index) => {
      const id = this.idFactory({ puzzle, index, weaknessCategory: focus.weaknessCategory });
      return {
        id,
        puzzle,
        weaknessCategory: focus.weaknessCategory,
        date: this.now(),
        seeded_weakness: focus.weaknessCategory,
        seed_puzzle_id: puzzle.PuzzleId ?? null,
        start_fen: getMotifReadyFen(puzzle)
      };
    });
    await this.storage.createQueuedGames(this.db, queued);
    this.queue.push(...queued);
    const activeSession2 = await this.startQueuedSession(queued[0].id);
    return { ...focus, activeSession: activeSession2, queued };
  }
  async startQueuedSession(gameId) {
    const descriptor = this.queue.find((item) => item.id === gameId);
    if (!descriptor) throw new Error(`Queued session not found: ${gameId}`);
    const motifFen = descriptor.start_fen || (descriptor.puzzle ? getMotifReadyFen(descriptor.puzzle) : null);
    const turnToken = motifFen ? motifFen.split(" ")[1] : "w";
    const playerColor = turnToken === "b" ? "black" : "white";
    const session = new PracticeSession({
      puzzle: {
        ...descriptor.puzzle,
        weaknessCategory: descriptor.weaknessCategory
      },
      playerColor,
      engine: this.engineFactory(descriptor),
      skillLevel: this.skillLevel,
      gameId,
      now: this.now
    });
    await this.storage.transitionGameStatus(this.db, gameId, "in_progress");
    this.sessions.set(gameId, session);
    return session;
  }
  async startNextQueuedSession() {
    for (const item of this.queue) {
      const status = await this.storage.getGameStatus(this.db, item.id);
      if (status === "queued") {
        return await this.startQueuedSession(item.id);
      }
    }
    return null;
  }
  async completeSession(sessionOrSummary) {
    const summary = typeof sessionOrSummary?.summary === "function" ? sessionOrSummary.summary() : sessionOrSummary;
    await this.storage.completeGameSession(this.db, summary);
    this.sessions.delete(summary.id);
    return summary.id;
  }
  async markAnalyzed(gameId) {
    return await this.storage.transitionGameStatus(this.db, gameId, "analyzed");
  }
};

// data/corpusManifest.js
var CORPUS_MANIFEST = Object.freeze({
  version: "m9-v1",
  puzzleCount: 7200,
  sha256: "0c3be26539d64355de521908d884f4f48bc21d1eda46769f932d45910753cf6e",
  url: "https://github.com/oliverquee/chess/releases/download/m9-corpus-v1/puzzles-subset.jsonl.gz"
});

// engine/clock.js
var STANDARD_TIME_CONTROLS = Object.freeze([
  { id: "1|0", name: "Bullet 1|0", baseSeconds: 60, incrementSeconds: 0 },
  { id: "3|0", name: "Blitz 3|0", baseSeconds: 180, incrementSeconds: 0 },
  { id: "3|2", name: "Blitz 3|2", baseSeconds: 180, incrementSeconds: 2 },
  { id: "5|0", name: "Rapid 5|0", baseSeconds: 300, incrementSeconds: 0 },
  { id: "10|0", name: "Rapid 10|0", baseSeconds: 600, incrementSeconds: 0 },
  { id: "15|10", name: "Classical 15|10", baseSeconds: 900, incrementSeconds: 10 },
  { id: "none", name: "Untimed", baseSeconds: null, incrementSeconds: 0 }
]);
function parseTimeControl(tc) {
  if (!tc || tc === "none" || tc === "untimed" || tc === "unlimited" || tc === "\u221E") {
    return { baseSeconds: null, incrementSeconds: 0, isUntimed: true };
  }
  const match = String(tc).trim().match(/^(\d+)\|(\d+)$/);
  if (!match) {
    throw new RangeError(`Invalid time control format: "${tc}". Expected "M|S" or "none".`);
  }
  const baseMinutes = Number.parseInt(match[1], 10);
  const incrementSeconds = Number.parseInt(match[2], 10);
  return {
    baseSeconds: baseMinutes * 60,
    incrementSeconds,
    isUntimed: false
  };
}
function formatClockTime(ms) {
  if (ms === null || ms === void 0 || !Number.isFinite(ms) || ms < 0) {
    ms = 0;
  }
  const totalSeconds = Math.floor(ms / 1e3);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  if (totalSeconds < 10 && ms > 0) {
    const tenths = Math.floor(ms % 1e3 / 100);
    return `${mm}:${ss}.${tenths}`;
  }
  return `${mm}:${ss}`;
}
var ChessClock = class {
  constructor({
    timeControl = "5|0",
    onFlagFall = null,
    now = () => Date.now()
  } = {}) {
    this.timeControl = timeControl;
    this.onFlagFall = typeof onFlagFall === "function" ? onFlagFall : null;
    this.now = now;
    const parsed = parseTimeControl(timeControl);
    this.isUntimed = parsed.isUntimed;
    this.baseMs = parsed.baseSeconds !== null ? parsed.baseSeconds * 1e3 : null;
    this.incrementMs = parsed.incrementSeconds * 1e3;
    this.whiteTimeMs = this.baseMs;
    this.blackTimeMs = this.baseMs;
    this.activeColor = null;
    this.isRunning = false;
    this.lastTickTimestamp = null;
    this.flagFallenColor = null;
  }
  _normalizeColor(color) {
    if (!color) return null;
    const lower = String(color).toLowerCase();
    if (lower === "w" || lower === "white") return "white";
    if (lower === "b" || lower === "black") return "black";
    throw new RangeError(`Unknown color: ${color}`);
  }
  start(initialColor = "white", nowMs = this.now()) {
    if (this.isUntimed) return;
    const color = this._normalizeColor(initialColor);
    this.activeColor = color;
    this.isRunning = true;
    this.lastTickTimestamp = nowMs;
  }
  _updateActiveColorElapsed(nowMs = this.now()) {
    if (!this.isRunning || !this.activeColor || this.isUntimed || this.lastTickTimestamp === null) {
      return;
    }
    const elapsed = Math.max(0, nowMs - this.lastTickTimestamp);
    if (this.activeColor === "white") {
      this.whiteTimeMs = Math.max(0, this.whiteTimeMs - elapsed);
      if (this.whiteTimeMs <= 0 && !this.flagFallenColor) {
        this.flagFallenColor = "white";
        this.isRunning = false;
        this.onFlagFall?.("white");
      }
    } else if (this.activeColor === "black") {
      this.blackTimeMs = Math.max(0, this.blackTimeMs - elapsed);
      if (this.blackTimeMs <= 0 && !this.flagFallenColor) {
        this.flagFallenColor = "black";
        this.isRunning = false;
        this.onFlagFall?.("black");
      }
    }
    this.lastTickTimestamp = nowMs;
  }
  switchTurn(nextColor, nowMs = this.now()) {
    if (this.isUntimed) return;
    this._updateActiveColorElapsed(nowMs);
    if (this.flagFallenColor) return;
    if (this.activeColor === "white") {
      this.whiteTimeMs += this.incrementMs;
    } else if (this.activeColor === "black") {
      this.blackTimeMs += this.incrementMs;
    }
    this.activeColor = this._normalizeColor(nextColor);
    this.lastTickTimestamp = nowMs;
    this.isRunning = true;
  }
  pause(nowMs = this.now()) {
    if (this.isUntimed) return;
    this._updateActiveColorElapsed(nowMs);
    this.isRunning = false;
  }
  resume(nowMs = this.now()) {
    if (this.isUntimed || this.flagFallenColor) return;
    this.lastTickTimestamp = nowMs;
    this.isRunning = true;
  }
  getTime(color, nowMs = this.now()) {
    if (this.isUntimed) return null;
    const normalized = this._normalizeColor(color);
    if (this.isRunning && this.activeColor === normalized && this.lastTickTimestamp !== null) {
      const elapsed = Math.max(0, nowMs - this.lastTickTimestamp);
      const remaining = (normalized === "white" ? this.whiteTimeMs : this.blackTimeMs) - elapsed;
      return Math.max(0, remaining);
    }
    return normalized === "white" ? this.whiteTimeMs : this.blackTimeMs;
  }
  isFlagFallen(color, nowMs = this.now()) {
    if (this.isUntimed) return false;
    const time = this.getTime(color, nowMs);
    return time !== null && time <= 0;
  }
  state(nowMs = this.now()) {
    return {
      timeControl: this.timeControl,
      isUntimed: this.isUntimed,
      activeColor: this.activeColor,
      isRunning: this.isRunning,
      whiteTimeMs: this.getTime("white", nowMs),
      blackTimeMs: this.getTime("black", nowMs),
      flagFallenColor: this.flagFallenColor
    };
  }
};

// engine/evalBar.js
var SIGMOID_COEFFICIENT = -368208e-8;
var MATE_SCORE_THRESHOLD = 9e4;
function evalToWinPercent(evalCp, isMate = false) {
  if (evalCp === null || evalCp === void 0 || !Number.isFinite(evalCp)) {
    return 50;
  }
  if (isMate || Math.abs(evalCp) >= MATE_SCORE_THRESHOLD) {
    return evalCp > 0 ? 100 : 0;
  }
  const sigmoid = 2 / (1 + Math.exp(SIGMOID_COEFFICIENT * evalCp)) - 1;
  const percent = 50 + 50 * sigmoid;
  return Number(Math.min(100, Math.max(0, percent)).toFixed(1));
}
function formatEvalLabel(evalCp, isMate = false) {
  if (evalCp === null || evalCp === void 0 || !Number.isFinite(evalCp)) {
    return "0.0";
  }
  if (isMate || Math.abs(evalCp) >= MATE_SCORE_THRESHOLD) {
    return evalCp > 0 ? "+M" : "-M";
  }
  const pawns = (evalCp / 100).toFixed(1);
  if (evalCp > 0) return `+${pawns}`;
  if (evalCp === 0) return "0.0";
  return pawns;
}
function computeEvalBarState(analysis = {}) {
  const evalCp = analysis?.evalCp ?? 0;
  const isMate = Boolean(analysis?.isMateScore);
  const whiteWinPercent = evalToWinPercent(evalCp, isMate);
  const blackWinPercent = Number((100 - whiteWinPercent).toFixed(1));
  const label = formatEvalLabel(evalCp, isMate);
  return {
    evalCp,
    isMate,
    whiteWinPercent,
    blackWinPercent,
    label,
    // CSS height for White's portion of the vertical bar
    whiteHeightPercent: whiteWinPercent
  };
}

// engine/hints.js
var PIECE_NAMES = Object.freeze({
  p: "Pawn",
  n: "Knight",
  b: "Bishop",
  r: "Rook",
  q: "Queen",
  k: "King"
});
var PIECE_VALUES = Object.freeze({
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 2e4
});
function parseFenBoard(fen) {
  const parts = String(fen).trim().split(/\s+/);
  const rows = parts[0].split("/");
  const board = [];
  for (let r = 0; r < 8; r += 1) {
    const row = [];
    for (const char of rows[r]) {
      if (/\d/.test(char)) {
        const count = Number.parseInt(char, 10);
        for (let i = 0; i < count; i += 1) row.push(null);
      } else {
        row.push(char);
      }
    }
    board.push(row);
  }
  const activeColor = parts[1] === "b" ? "black" : "white";
  return { board, activeColor, fullFen: fen };
}
function squareToCoords(square) {
  if (!square || square.length < 2) return null;
  const file2 = square.charCodeAt(0) - "a".charCodeAt(0);
  const rank2 = 8 - Number.parseInt(square[1], 10);
  if (file2 < 0 || file2 > 7 || rank2 < 0 || rank2 > 7) return null;
  return { row: rank2, col: file2 };
}
function getPieceAt(board, square) {
  const coords = squareToCoords(square);
  if (!coords) return null;
  return board[coords.row][coords.col];
}
function getNullMoveFen(fen) {
  const parts = String(fen).trim().split(/\s+/);
  if (parts.length < 2) return fen;
  const currentTurn = parts[1];
  const nextTurn = currentTurn === "w" ? "b" : "w";
  const castling = parts[2] || "-";
  const enPassant = "-";
  const halfMoves = parts[4] !== void 0 && !Number.isNaN(Number.parseInt(parts[4], 10)) ? String(Number.parseInt(parts[4], 10) + 1) : "0";
  const fullMoves = parts[5] || "1";
  return `${parts[0]} ${nextTurn} ${castling} ${enPassant} ${halfMoves} ${fullMoves}`;
}
async function getTier1Hint(fen, engine) {
  const { board, activeColor } = parseFenBoard(fen);
  const analysis = await engine.analyzePosition(fen, 8);
  const bestMove = analysis?.bestMove;
  if (bestMove && bestMove.length >= 4) {
    const fromSquare = bestMove.slice(0, 2);
    const toSquare = bestMove.slice(2, 4);
    const targetPiece = getPieceAt(board, toSquare);
    const attackingPiece = getPieceAt(board, fromSquare);
    if (targetPiece) {
      const pieceName = PIECE_NAMES[targetPiece.toLowerCase()] || "piece";
      return {
        tier: "warm",
        type: "tactical_target",
        square: toSquare,
        message: `Look at the ${pieceName} on ${toSquare}. There is tactical tension around that square.`
      };
    }
  }
  return {
    tier: "warm",
    type: "board_awareness",
    message: `Scan for undefended pieces and checks. Where can your pieces improve their activity?`
  };
}
async function getTier2Hint(fen, engine) {
  const nullFen = getNullMoveFen(fen);
  let threatMove = null;
  try {
    const threatAnalysis = await engine.analyzePosition(nullFen, 8);
    threatMove = threatAnalysis?.bestMove;
  } catch {
  }
  if (threatMove && threatMove.length >= 4) {
    const fromSquare = threatMove.slice(0, 2);
    const toSquare = threatMove.slice(2, 4);
    const { board } = parseFenBoard(fen);
    const opponentPiece = getPieceAt(board, fromSquare);
    const pieceName = opponentPiece ? PIECE_NAMES[opponentPiece.toLowerCase()] || "piece" : "opponent piece";
    return {
      tier: "warmer",
      type: "opponent_threat",
      threatMove,
      fromSquare,
      toSquare,
      message: `Opponent Threat: If you make a passive move, opponent could play ${pieceName} to ${toSquare}!`
    };
  }
  return {
    tier: "warmer",
    type: "opponent_threat",
    message: `Watch out for opponent's central breaks and attacks toward your position.`
  };
}
async function getTier3Hint(fen, engine) {
  const analysis = await engine.analyzePosition(fen, 12);
  const bestMove = analysis?.bestMove;
  if (bestMove && bestMove.length >= 4) {
    const fromSquare = bestMove.slice(0, 2);
    const toSquare = bestMove.slice(2, 4);
    const { board } = parseFenBoard(fen);
    const piece = getPieceAt(board, fromSquare);
    const pieceName = piece ? PIECE_NAMES[piece.toLowerCase()] || "piece" : "piece";
    return {
      tier: "hot",
      type: "best_move_nudge",
      bestMove,
      fromSquare,
      toSquare,
      message: `Key Move: Consider moving your ${pieceName} from ${fromSquare} toward ${toSquare}.`
    };
  }
  return {
    tier: "hot",
    type: "best_move_nudge",
    message: `Look for the most active and forcing move in the current position.`
  };
}
async function generateHint(fen, tier, engine) {
  switch (tier) {
    case "warm":
      return getTier1Hint(fen, engine);
    case "warmer":
      return getTier2Hint(fen, engine);
    case "hot":
      return getTier3Hint(fen, engine);
    default:
      throw new RangeError(`Unknown hint tier: ${tier}. Expected 'warm', 'warmer', or 'hot'.`);
  }
}
async function checkBlunderCandidate(fenBefore, proposedMove, engine) {
  if (!fenBefore || !proposedMove || !engine) {
    return { isBlunder: false, evalDelta: 0 };
  }
  const { activeColor } = parseFenBoard(fenBefore);
  const beforeAnalysis = await engine.analyzePosition(fenBefore, 10);
  const fenAfter = applyUciMoveToFen(fenBefore, proposedMove);
  const afterAnalysis = await engine.analyzePosition(fenAfter, 10);
  const evalBefore = beforeAnalysis?.evalCp ?? 0;
  const evalAfter = afterAnalysis?.evalCp ?? 0;
  let loss = 0;
  if (activeColor === "white") {
    loss = evalBefore - evalAfter;
  } else {
    loss = evalAfter - evalBefore;
  }
  const allowedMate = Boolean(afterAnalysis?.isMateScore && (activeColor === "white" && evalAfter < 0 || activeColor === "black" && evalAfter > 0));
  const isBlunder = Boolean(loss >= 200 || allowedMate);
  return {
    isBlunder,
    evalDelta: loss,
    evalBefore,
    evalAfter,
    bestMove: beforeAnalysis?.bestMove ?? null,
    message: isBlunder ? `Blunder Warning: This move drops ${loss >= 200 ? Math.round(loss / 100) + " pawns" : "the game"}!` : null
  };
}

// engine/eval.js
function nullableInteger(value, fieldName) {
  if (value === null || value === void 0) return null;
  if (!Number.isInteger(value)) throw new TypeError(`${fieldName} must be an integer or null.`);
  return value;
}
function computeEvalDelta(log) {
  if (!log || typeof log !== "object") throw new TypeError("log must be an object.");
  const before = nullableInteger(log.eval_cp_before, "log.eval_cp_before");
  const after = nullableInteger(log.eval_cp_after, "log.eval_cp_after");
  if (before === null || after === null) return null;
  if (Boolean(log.is_mate_score)) return null;
  return -after - before;
}

// core/scoring.js
function computeMoveAccuracy(log) {
  if (!log || typeof log !== "object") return 100;
  const delta = computeEvalDelta(log);
  if (delta === null || delta === void 0) return 100;
  if (delta >= 0) return 100;
  const loss = Math.abs(delta);
  const accuracy = Math.max(0, 100 - loss * 0.4);
  return Number(accuracy.toFixed(1));
}
function calculateSeedScore(sessionSummary) {
  if (!sessionSummary || typeof sessionSummary !== "object") {
    return {
      accuracyComponent: 0,
      motifComponent: 0,
      hintPenalty: 0,
      totalScore: 0,
      grade: "D"
    };
  }
  const moves = Array.isArray(sessionSummary.moves) ? sessionSummary.moves : [];
  const playerColor = sessionSummary.player_color || "white";
  const playerMoves = moves.filter((m) => {
    const isPlayer = playerColor === "white" ? m.ply_number % 2 === 1 : m.ply_number % 2 === 0;
    return isPlayer;
  });
  let accuracyComponent = 60;
  if (playerMoves.length > 0) {
    const accuracies = playerMoves.map((m) => computeMoveAccuracy(m));
    const meanAccuracy = accuracies.reduce((a, b) => a + b, 0) / accuracies.length;
    accuracyComponent = Number((meanAccuracy * 0.6).toFixed(1));
  }
  let motifComponent = 15;
  const result = sessionSummary.result;
  if (result) {
    const won = playerColor === "white" && result === "1-0" || playerColor === "black" && result === "0-1";
    const lost = playerColor === "white" && result === "0-1" || playerColor === "black" && result === "1-0";
    const drawn = result === "1/2-1/2";
    if (won) motifComponent = 30;
    else if (drawn) motifComponent = 15;
    else if (lost) motifComponent = 0;
  } else if (moves.length > 0) {
    const lastMove = moves[moves.length - 1];
    const finalEval = lastMove.eval_cp_after ?? lastMove.eval_cp_before ?? 0;
    const isPlayerAhead = playerColor === "white" ? finalEval > 50 : finalEval < -50;
    motifComponent = isPlayerAhead ? 25 : 10;
  }
  const hintCount = sessionSummary.hint_count || 0;
  const hintPenalty = Number(Math.min(30, hintCount * 10).toFixed(1));
  const rawTotal = accuracyComponent + motifComponent - hintPenalty;
  const totalScore = Number(Math.max(0, Math.min(100, rawTotal)).toFixed(1));
  let grade = "D";
  if (totalScore >= 95) grade = "A+";
  else if (totalScore >= 85) grade = "A";
  else if (totalScore >= 70) grade = "B";
  else if (totalScore >= 50) grade = "C";
  return {
    accuracyComponent,
    motifComponent,
    hintPenalty,
    totalScore,
    grade
  };
}

// core/streaks.js
var DEFAULT_DAILY_GOAL = 3;
var MONTHLY_FREEZES = 2;
var MASTERY_CATEGORIES = Object.freeze([
  "tactical",
  "king_safety",
  "pawn_structure",
  "piece_activity",
  "positional_judgment",
  "endgame_technique",
  "practical_time"
]);
function parseDateDays(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-").map((n) => Number.parseInt(n, 10));
  return Date.UTC(y, m - 1, d) / (1e3 * 60 * 60 * 24);
}
function processDailyStreakUpdate({
  streakState = {},
  currentDate = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
  sessionsCompletedToday = 0,
  goalTarget = DEFAULT_DAILY_GOAL
} = {}) {
  let currentStreak = streakState?.currentStreak ?? streakState?.current_streak ?? 0;
  let longestStreak = streakState?.longestStreak ?? streakState?.longest_streak ?? 0;
  let freezesRemaining = streakState?.freezesRemaining ?? streakState?.freezes_remaining ?? MONTHLY_FREEZES;
  let freezesMonth = streakState?.freezesMonth ?? streakState?.freezes_month ?? null;
  let lastCountedDate = streakState?.lastCountedDate ?? streakState?.last_counted_date ?? null;
  const currentMonth = currentDate.slice(0, 7);
  if (freezesMonth !== currentMonth) {
    freezesMonth = currentMonth;
    freezesRemaining = MONTHLY_FREEZES;
  }
  let usedFreeze = false;
  let streakBroken = false;
  if (sessionsCompletedToday >= goalTarget) {
    if (lastCountedDate === currentDate) {
      return {
        currentStreak,
        longestStreak,
        freezesRemaining,
        freezesMonth,
        lastCountedDate,
        usedFreeze,
        streakBroken
      };
    }
    if (!lastCountedDate) {
      currentStreak = 1;
    } else {
      const currentDays = parseDateDays(currentDate);
      const lastDays = parseDateDays(lastCountedDate);
      const diffDays = currentDays - lastDays;
      if (diffDays === 1) {
        currentStreak += 1;
      } else if (diffDays > 1) {
        const daysMissed = diffDays - 1;
        if (daysMissed <= freezesRemaining) {
          freezesRemaining -= daysMissed;
          currentStreak += 1;
          usedFreeze = true;
        } else {
          currentStreak = 1;
          streakBroken = true;
        }
      }
    }
    if (currentStreak > longestStreak) {
      longestStreak = currentStreak;
    }
    lastCountedDate = currentDate;
  }
  return {
    currentStreak,
    longestStreak,
    freezesRemaining,
    freezesMonth,
    lastCountedDate,
    usedFreeze,
    streakBroken
  };
}
function advanceCategoryMastery(currentLevel = 0, sessionScore = 0) {
  const level = Number.isInteger(currentLevel) ? currentLevel : 0;
  if (sessionScore >= 70) {
    return Math.min(5, level + 1);
  }
  return level;
}

// storage/mobileDb.js
var mobileDb_exports = {};
__export(mobileDb_exports, {
  completeGameSession: () => completeGameSession,
  createQueuedGame: () => createQueuedGame,
  createQueuedGames: () => createQueuedGames,
  exportDatabaseJson: () => exportDatabaseJson,
  getCategoryMastery: () => getCategoryMastery,
  getDailyStats: () => getDailyStats,
  getGameById: () => getGameById,
  getGameHistory: () => getGameHistory,
  getGameStatus: () => getGameStatus,
  getHintLogs: () => getHintLogs,
  getMoveClassifications: () => getMoveClassifications,
  getProfileStats: () => getProfileStats,
  getRecentDailyStats: () => getRecentDailyStats,
  getSeedScore: () => getSeedScore,
  getSettings: () => getSettings,
  getStreakState: () => getStreakState,
  getWeaknessTally: () => getWeaknessTally,
  importDatabaseJson: () => importDatabaseJson,
  initDb: () => initDb,
  recordDailySession: () => recordDailySession,
  resetUserData: () => resetUserData,
  saveGameSession: () => saveGameSession,
  saveHintLog: () => saveHintLog,
  saveMoveClassification: () => saveMoveClassification,
  saveSeedScore: () => saveSeedScore,
  saveWeaknessTags: () => saveWeaknessTags,
  setSetting: () => setSetting,
  transitionGameStatus: () => transitionGameStatus,
  updateCategoryMastery: () => updateCategoryMastery,
  updateStreakState: () => updateStreakState
});

// node_modules/@capacitor-community/sqlite/dist/esm/index.js
init_dist();

// node_modules/@capacitor-community/sqlite/dist/esm/definitions.js
var SQLiteConnection = class {
  constructor(sqlite) {
    this.sqlite = sqlite;
    this._connectionDict = /* @__PURE__ */ new Map();
  }
  async initWebStore() {
    try {
      await this.sqlite.initWebStore();
      return Promise.resolve();
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async saveToStore(database) {
    try {
      await this.sqlite.saveToStore({ database });
      return Promise.resolve();
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async saveToLocalDisk(database) {
    try {
      await this.sqlite.saveToLocalDisk({ database });
      return Promise.resolve();
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async getFromLocalDiskToStore(overwrite) {
    const mOverwrite = overwrite != null ? overwrite : true;
    try {
      await this.sqlite.getFromLocalDiskToStore({ overwrite: mOverwrite });
      return Promise.resolve();
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async echo(value) {
    try {
      const res = await this.sqlite.echo({ value });
      return Promise.resolve(res);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async isSecretStored() {
    try {
      const res = await this.sqlite.isSecretStored();
      return Promise.resolve(res);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async setEncryptionSecret(passphrase) {
    try {
      await this.sqlite.setEncryptionSecret({ passphrase });
      return Promise.resolve();
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async changeEncryptionSecret(passphrase, oldpassphrase) {
    try {
      await this.sqlite.changeEncryptionSecret({
        passphrase,
        oldpassphrase
      });
      return Promise.resolve();
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async clearEncryptionSecret() {
    try {
      await this.sqlite.clearEncryptionSecret();
      return Promise.resolve();
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async checkEncryptionSecret(passphrase) {
    try {
      const res = await this.sqlite.checkEncryptionSecret({
        passphrase
      });
      return Promise.resolve(res);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async addUpgradeStatement(database, upgrade) {
    try {
      if (database.endsWith(".db"))
        database = database.slice(0, -3);
      await this.sqlite.addUpgradeStatement({
        database,
        upgrade
      });
      return Promise.resolve();
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async createConnection(database, encrypted, mode, version, readonly) {
    try {
      if (database.endsWith(".db"))
        database = database.slice(0, -3);
      await this.sqlite.createConnection({
        database,
        encrypted,
        mode,
        version,
        readonly
      });
      const conn = new SQLiteDBConnection(database, readonly, this.sqlite);
      const connName = readonly ? `RO_${database}` : `RW_${database}`;
      this._connectionDict.set(connName, conn);
      return Promise.resolve(conn);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async closeConnection(database, readonly) {
    try {
      if (database.endsWith(".db"))
        database = database.slice(0, -3);
      await this.sqlite.closeConnection({ database, readonly });
      const connName = readonly ? `RO_${database}` : `RW_${database}`;
      this._connectionDict.delete(connName);
      return Promise.resolve();
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async isConnection(database, readonly) {
    const res = {};
    if (database.endsWith(".db"))
      database = database.slice(0, -3);
    const connName = readonly ? `RO_${database}` : `RW_${database}`;
    res.result = this._connectionDict.has(connName);
    return Promise.resolve(res);
  }
  async retrieveConnection(database, readonly) {
    if (database.endsWith(".db"))
      database = database.slice(0, -3);
    const connName = readonly ? `RO_${database}` : `RW_${database}`;
    if (this._connectionDict.has(connName)) {
      const conn = this._connectionDict.get(connName);
      if (typeof conn != "undefined")
        return Promise.resolve(conn);
      else {
        return Promise.reject(`Connection ${database} is undefined`);
      }
    } else {
      return Promise.reject(`Connection ${database} does not exist`);
    }
  }
  async getNCDatabasePath(path, database) {
    try {
      const databasePath = await this.sqlite.getNCDatabasePath({
        path,
        database
      });
      return Promise.resolve(databasePath);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async createNCConnection(databasePath, version) {
    try {
      await this.sqlite.createNCConnection({
        databasePath,
        version
      });
      const conn = new SQLiteDBConnection(databasePath, true, this.sqlite);
      const connName = `RO_${databasePath})`;
      this._connectionDict.set(connName, conn);
      return Promise.resolve(conn);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async closeNCConnection(databasePath) {
    try {
      await this.sqlite.closeNCConnection({ databasePath });
      const connName = `RO_${databasePath})`;
      this._connectionDict.delete(connName);
      return Promise.resolve();
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async isNCConnection(databasePath) {
    const res = {};
    const connName = `RO_${databasePath})`;
    res.result = this._connectionDict.has(connName);
    return Promise.resolve(res);
  }
  async retrieveNCConnection(databasePath) {
    if (this._connectionDict.has(databasePath)) {
      const connName = `RO_${databasePath})`;
      const conn = this._connectionDict.get(connName);
      if (typeof conn != "undefined")
        return Promise.resolve(conn);
      else {
        return Promise.reject(`Connection ${databasePath} is undefined`);
      }
    } else {
      return Promise.reject(`Connection ${databasePath} does not exist`);
    }
  }
  async isNCDatabase(databasePath) {
    try {
      const res = await this.sqlite.isNCDatabase({ databasePath });
      return Promise.resolve(res);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async retrieveAllConnections() {
    return this._connectionDict;
  }
  async closeAllConnections() {
    const delDict = /* @__PURE__ */ new Map();
    try {
      for (const key of this._connectionDict.keys()) {
        const database = key.substring(3);
        const readonly = key.substring(0, 3) === "RO_" ? true : false;
        await this.sqlite.closeConnection({ database, readonly });
        delDict.set(key, null);
      }
      for (const key of delDict.keys()) {
        this._connectionDict.delete(key);
      }
      return Promise.resolve();
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async checkConnectionsConsistency() {
    try {
      const keys = [...this._connectionDict.keys()];
      const openModes = [];
      const dbNames = [];
      for (const key of keys) {
        openModes.push(key.substring(0, 2));
        dbNames.push(key.substring(3));
      }
      const res = await this.sqlite.checkConnectionsConsistency({
        dbNames,
        openModes
      });
      if (!res.result)
        this._connectionDict = /* @__PURE__ */ new Map();
      return Promise.resolve(res);
    } catch (err) {
      this._connectionDict = /* @__PURE__ */ new Map();
      return Promise.reject(err);
    }
  }
  async importFromJson(jsonstring) {
    try {
      const ret = await this.sqlite.importFromJson({ jsonstring });
      return Promise.resolve(ret);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async isJsonValid(jsonstring) {
    try {
      const ret = await this.sqlite.isJsonValid({ jsonstring });
      return Promise.resolve(ret);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async copyFromAssets(overwrite) {
    const mOverwrite = overwrite != null ? overwrite : true;
    try {
      await this.sqlite.copyFromAssets({ overwrite: mOverwrite });
      return Promise.resolve();
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async getFromHTTPRequest(url, overwrite) {
    const mOverwrite = overwrite != null ? overwrite : true;
    try {
      await this.sqlite.getFromHTTPRequest({ url, overwrite: mOverwrite });
      return Promise.resolve();
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async isDatabaseEncrypted(database) {
    if (database.endsWith(".db"))
      database = database.slice(0, -3);
    try {
      const res = await this.sqlite.isDatabaseEncrypted({ database });
      return Promise.resolve(res);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async isInConfigEncryption() {
    try {
      const res = await this.sqlite.isInConfigEncryption();
      return Promise.resolve(res);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async isInConfigBiometricAuth() {
    try {
      const res = await this.sqlite.isInConfigBiometricAuth();
      return Promise.resolve(res);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async isDatabase(database) {
    if (database.endsWith(".db"))
      database = database.slice(0, -3);
    try {
      const res = await this.sqlite.isDatabase({ database });
      return Promise.resolve(res);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async getDatabaseList() {
    try {
      const res = await this.sqlite.getDatabaseList();
      const values = res.values;
      values.sort();
      const ret = { values };
      return Promise.resolve(ret);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async getMigratableDbList(folderPath) {
    const path = folderPath ? folderPath : "default";
    try {
      const res = await this.sqlite.getMigratableDbList({
        folderPath: path
      });
      return Promise.resolve(res);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async addSQLiteSuffix(folderPath, dbNameList) {
    const path = folderPath ? folderPath : "default";
    const dbList = dbNameList ? dbNameList : [];
    try {
      const res = await this.sqlite.addSQLiteSuffix({
        folderPath: path,
        dbNameList: dbList
      });
      return Promise.resolve(res);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async deleteOldDatabases(folderPath, dbNameList) {
    const path = folderPath ? folderPath : "default";
    const dbList = dbNameList ? dbNameList : [];
    try {
      const res = await this.sqlite.deleteOldDatabases({
        folderPath: path,
        dbNameList: dbList
      });
      return Promise.resolve(res);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async moveDatabasesAndAddSuffix(folderPath, dbNameList) {
    const path = folderPath ? folderPath : "default";
    const dbList = dbNameList ? dbNameList : [];
    return this.sqlite.moveDatabasesAndAddSuffix({
      folderPath: path,
      dbNameList: dbList
    });
  }
};
var SQLiteDBConnection = class {
  constructor(dbName, readonly, sqlite) {
    this.dbName = dbName;
    this.readonly = readonly;
    this.sqlite = sqlite;
  }
  getConnectionDBName() {
    return this.dbName;
  }
  getConnectionReadOnly() {
    return this.readonly;
  }
  async open() {
    try {
      await this.sqlite.open({
        database: this.dbName,
        readonly: this.readonly
      });
      return Promise.resolve();
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async close() {
    try {
      await this.sqlite.close({
        database: this.dbName,
        readonly: this.readonly
      });
      return Promise.resolve();
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async beginTransaction() {
    try {
      const changes = await this.sqlite.beginTransaction({
        database: this.dbName
      });
      return Promise.resolve(changes);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async commitTransaction() {
    try {
      const changes = await this.sqlite.commitTransaction({
        database: this.dbName
      });
      return Promise.resolve(changes);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async rollbackTransaction() {
    try {
      const changes = await this.sqlite.rollbackTransaction({
        database: this.dbName
      });
      return Promise.resolve(changes);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async isTransactionActive() {
    try {
      const result = await this.sqlite.isTransactionActive({
        database: this.dbName
      });
      return Promise.resolve(result);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async loadExtension(path) {
    try {
      await this.sqlite.loadExtension({
        database: this.dbName,
        path,
        readonly: this.readonly
      });
      return Promise.resolve();
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async enableLoadExtension(toggle) {
    try {
      await this.sqlite.enableLoadExtension({
        database: this.dbName,
        toggle,
        readonly: this.readonly
      });
      return Promise.resolve();
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async getUrl() {
    try {
      const res = await this.sqlite.getUrl({
        database: this.dbName,
        readonly: this.readonly
      });
      return Promise.resolve(res);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async getVersion() {
    try {
      const version = await this.sqlite.getVersion({
        database: this.dbName,
        readonly: this.readonly
      });
      return Promise.resolve(version);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async getTableList() {
    try {
      const res = await this.sqlite.getTableList({
        database: this.dbName,
        readonly: this.readonly
      });
      return Promise.resolve(res);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async execute(statements, transaction = true, isSQL92 = true) {
    try {
      if (!this.readonly) {
        const res = await this.sqlite.execute({
          database: this.dbName,
          statements,
          transaction,
          readonly: false,
          isSQL92
        });
        return Promise.resolve(res);
      } else {
        return Promise.reject("not allowed in read-only mode");
      }
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async query(statement, values, isSQL92 = true) {
    let res;
    try {
      if (values && values.length > 0) {
        res = await this.sqlite.query({
          database: this.dbName,
          statement,
          values,
          readonly: this.readonly,
          isSQL92: true
        });
      } else {
        res = await this.sqlite.query({
          database: this.dbName,
          statement,
          values: [],
          readonly: this.readonly,
          isSQL92
        });
      }
      res = await this.reorderRows(res);
      return Promise.resolve(res);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async run(statement, values, transaction = true, returnMode = "no", isSQL92 = true) {
    let res;
    try {
      if (!this.readonly) {
        if (values && values.length > 0) {
          res = await this.sqlite.run({
            database: this.dbName,
            statement,
            values,
            transaction,
            readonly: false,
            returnMode,
            isSQL92: true
          });
        } else {
          res = await this.sqlite.run({
            database: this.dbName,
            statement,
            values: [],
            transaction,
            readonly: false,
            returnMode,
            isSQL92
          });
        }
        res.changes = await this.reorderRows(res.changes);
        return Promise.resolve(res);
      } else {
        return Promise.reject("not allowed in read-only mode");
      }
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async executeSet(set, transaction = true, returnMode = "no", isSQL92 = true) {
    let res;
    try {
      if (!this.readonly) {
        res = await this.sqlite.executeSet({
          database: this.dbName,
          set,
          transaction,
          readonly: false,
          returnMode,
          isSQL92
        });
        res.changes = await this.reorderRows(res.changes);
        return Promise.resolve(res);
      } else {
        return Promise.reject("not allowed in read-only mode");
      }
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async isExists() {
    try {
      const res = await this.sqlite.isDBExists({
        database: this.dbName,
        readonly: this.readonly
      });
      return Promise.resolve(res);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async isTable(table) {
    try {
      const res = await this.sqlite.isTableExists({
        database: this.dbName,
        table,
        readonly: this.readonly
      });
      return Promise.resolve(res);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async isDBOpen() {
    try {
      const res = await this.sqlite.isDBOpen({
        database: this.dbName,
        readonly: this.readonly
      });
      return Promise.resolve(res);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async delete() {
    try {
      if (!this.readonly) {
        await this.sqlite.deleteDatabase({
          database: this.dbName,
          readonly: false
        });
        return Promise.resolve();
      } else {
        return Promise.reject("not allowed in read-only mode");
      }
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async createSyncTable() {
    try {
      if (!this.readonly) {
        const res = await this.sqlite.createSyncTable({
          database: this.dbName,
          readonly: false
        });
        return Promise.resolve(res);
      } else {
        return Promise.reject("not allowed in read-only mode");
      }
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async setSyncDate(syncdate) {
    try {
      if (!this.readonly) {
        await this.sqlite.setSyncDate({
          database: this.dbName,
          syncdate,
          readonly: false
        });
        return Promise.resolve();
      } else {
        return Promise.reject("not allowed in read-only mode");
      }
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async getSyncDate() {
    try {
      const res = await this.sqlite.getSyncDate({
        database: this.dbName,
        readonly: this.readonly
      });
      let retDate = "";
      if (res.syncDate > 0)
        retDate = new Date(res.syncDate * 1e3).toISOString();
      return Promise.resolve(retDate);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async exportToJson(mode, encrypted = false) {
    try {
      const res = await this.sqlite.exportToJson({
        database: this.dbName,
        jsonexportmode: mode,
        readonly: this.readonly,
        encrypted
      });
      return Promise.resolve(res);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async deleteExportedRows() {
    try {
      if (!this.readonly) {
        await this.sqlite.deleteExportedRows({
          database: this.dbName,
          readonly: false
        });
        return Promise.resolve();
      } else {
        return Promise.reject("not allowed in read-only mode");
      }
    } catch (err) {
      return Promise.reject(err);
    }
  }
  async executeTransaction(txn, isSQL92 = true) {
    let changes = 0;
    let isActive = false;
    if (!this.readonly) {
      await this.sqlite.beginTransaction({
        database: this.dbName
      });
      isActive = await this.sqlite.isTransactionActive({
        database: this.dbName
      });
      if (!isActive) {
        return Promise.reject("After Begin Transaction, no transaction active");
      }
      try {
        for (const task of txn) {
          if (typeof task !== "object" || !("statement" in task)) {
            throw new Error("Error a task.statement must be provided");
          }
          if ("values" in task && task.values && task.values.length > 0) {
            const retMode = task.statement.toUpperCase().includes("RETURNING") ? "all" : "no";
            const ret = await this.sqlite.run({
              database: this.dbName,
              statement: task.statement,
              values: task.values,
              transaction: false,
              readonly: false,
              returnMode: retMode,
              isSQL92
            });
            if (ret.changes.changes < 0) {
              throw new Error("Error in transaction method run ");
            }
            changes += ret.changes.changes;
          } else {
            const ret = await this.sqlite.execute({
              database: this.dbName,
              statements: task.statement,
              transaction: false,
              readonly: false
            });
            if (ret.changes.changes < 0) {
              throw new Error("Error in transaction method execute ");
            }
            changes += ret.changes.changes;
          }
        }
        const retC = await this.sqlite.commitTransaction({
          database: this.dbName
        });
        changes += retC.changes.changes;
        const retChanges = { changes: { changes } };
        return Promise.resolve(retChanges);
      } catch (err) {
        const msg = err.message ? err.message : err;
        await this.sqlite.rollbackTransaction({
          database: this.dbName
        });
        return Promise.reject(msg);
      }
    } else {
      return Promise.reject("not allowed in read-only mode");
    }
  }
  async reorderRows(res) {
    const retRes = res;
    if (res?.values && typeof res.values[0] === "object") {
      if (Object.keys(res.values[0]).includes("ios_columns")) {
        const columnList = res.values[0]["ios_columns"];
        const iosRes = [];
        for (let i = 1; i < res.values.length; i++) {
          const rowJson = res.values[i];
          const resRowJson = {};
          for (const item of columnList) {
            resRowJson[item] = rowJson[item];
          }
          iosRes.push(resRowJson);
        }
        retRes["values"] = iosRes;
      }
    }
    return Promise.resolve(retRes);
  }
};

// node_modules/@capacitor-community/sqlite/dist/esm/index.js
var CapacitorSQLite = registerPlugin("CapacitorSQLite", {
  web: () => Promise.resolve().then(() => (init_web2(), web_exports2)).then((m) => new m.CapacitorSQLiteWeb()),
  electron: () => window.CapacitorCustomPlatform.plugins.CapacitorSQLite
});

// storage/mobileDb.js
var SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  date TEXT,
  mode TEXT CHECK(mode IN ('practice','imported','freeplay')),
  status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('queued','in_progress','completed','analyzed')),
  result TEXT,
  seeded_weakness TEXT NULL,
  seed_puzzle_id TEXT NULL,
  start_fen TEXT,
  current_fen TEXT,
  import_source TEXT NULL,
  external_game_id TEXT NULL,
  player_color TEXT NULL CHECK(player_color IN ('white','black')),
  white_player TEXT NULL,
  black_player TEXT NULL,
  analysis_engine TEXT NULL,
  analysis_depth INTEGER NULL,
  assistance_level TEXT NOT NULL DEFAULT 'none' CHECK(assistance_level IN ('none','preview','hints','full')),
  hint_count INTEGER NOT NULL DEFAULT 0,
  takeback_count INTEGER NOT NULL DEFAULT 0,
  time_control TEXT NULL,
  persona TEXT NULL
);

CREATE TABLE IF NOT EXISTS moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT REFERENCES games(id),
  ply_number INTEGER,
  fen_before TEXT,
  move_played TEXT,
  eval_cp_before INTEGER NULL,
  eval_cp_after INTEGER NULL,
  best_move TEXT NULL,
  principal_variation TEXT NULL,
  is_mate_score INTEGER NOT NULL DEFAULT 0 CHECK(is_mate_score IN (0,1)),
  stockfish_response TEXT NULL,
  timestamp TEXT,
  timestamp_source TEXT NOT NULL DEFAULT 'live_recorded'
    CHECK(timestamp_source IN ('live_recorded','posthoc_analysis'))
);

CREATE TABLE IF NOT EXISTS move_classifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  move_id INTEGER NOT NULL REFERENCES moves(id),
  status TEXT NOT NULL CHECK(status IN ('classified','unclassified')),
  category TEXT NULL CHECK(category IN (
    'tactical',
    'king_safety',
    'pawn_structure',
    'piece_activity',
    'positional_judgment',
    'endgame_technique',
    'practical_time'
  )),
  severity TEXT NULL CHECK(severity IN ('low','medium','high')),
  rationale TEXT NULL,
  error TEXT NULL,
  attempts INTEGER NOT NULL CHECK(attempts BETWEEN 1 AND 2),
  model_used TEXT NOT NULL,
  backend TEXT NOT NULL CHECK(backend IN ('claude','ollama')),
  prompt_version TEXT NOT NULL,
  prompt_hash TEXT NOT NULL,
  analysis_timestamp TEXT NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 1 CHECK(is_current IN (0,1)),
  CHECK(
    (status = 'classified' AND category IS NOT NULL AND severity IS NOT NULL AND rationale IS NOT NULL)
    OR
    (status = 'unclassified' AND category IS NULL AND severity IS NULL AND error IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS weakness_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  move_id INTEGER REFERENCES moves(id),
  category TEXT CHECK(category IN (
    'tactical',
    'king_safety',
    'pawn_structure',
    'piece_activity',
    'positional_judgment',
    'endgame_technique',
    'practical_time'
  )),
  severity TEXT CHECK(severity IN ('low','medium','high')),
  source TEXT DEFAULT 'ai_classification',
  classification_id INTEGER NULL REFERENCES move_classifications(id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS seed_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL REFERENCES games(id),
  accuracy_component REAL NOT NULL,
  motif_component REAL NOT NULL,
  hint_penalty REAL NOT NULL,
  total_score REAL NOT NULL,
  computed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_stats (
  date TEXT PRIMARY KEY,
  sessions_completed INTEGER NOT NULL DEFAULT 0,
  goal_target INTEGER NOT NULL DEFAULT 3,
  goal_met INTEGER NOT NULL DEFAULT 0 CHECK(goal_met IN (0,1)),
  total_score REAL NOT NULL DEFAULT 0,
  streak_day_counted INTEGER NOT NULL DEFAULT 0 CHECK(streak_day_counted IN (0,1))
);

CREATE TABLE IF NOT EXISTS streak_state (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  current_streak INTEGER NOT NULL DEFAULT 0,
  longest_streak INTEGER NOT NULL DEFAULT 0,
  freezes_remaining INTEGER NOT NULL DEFAULT 2,
  freezes_month TEXT NULL,
  last_counted_date TEXT NULL
);

CREATE TABLE IF NOT EXISTS category_mastery (
  category TEXT PRIMARY KEY CHECK(category IN (
    'tactical',
    'king_safety',
    'pawn_structure',
    'piece_activity',
    'positional_judgment',
    'endgame_technique',
    'practical_time'
  )),
  mastery_level INTEGER NOT NULL DEFAULT 0 CHECK(mastery_level BETWEEN 0 AND 5),
  last_practiced_at TEXT NULL,
  decay_checked_at TEXT NULL
);

CREATE TABLE IF NOT EXISTS hint_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL REFERENCES games(id),
  fen TEXT NOT NULL,
  tier TEXT NOT NULL CHECK(tier IN ('warm','warmer','hot')),
  detector TEXT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_games_seeded_weakness ON games(seeded_weakness);
CREATE INDEX IF NOT EXISTS idx_moves_game_id ON moves(game_id);
CREATE INDEX IF NOT EXISTS idx_weakness_tags_category ON weakness_tags(category);
CREATE INDEX IF NOT EXISTS idx_move_classifications_move_id ON move_classifications(move_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_move_classifications_current
  ON move_classifications(move_id) WHERE is_current = 1;
CREATE INDEX IF NOT EXISTS idx_seed_scores_game_id ON seed_scores(game_id);
CREATE INDEX IF NOT EXISTS idx_hint_logs_game_id ON hint_logs(game_id);
`;
var ALLOWED_MODES = /* @__PURE__ */ new Set(["practice", "imported", "freeplay"]);
var SESSION_TRANSITIONS = Object.freeze({
  queued: "in_progress",
  in_progress: "completed",
  completed: "analyzed"
});
var WEAKNESS_CATEGORIES2 = /* @__PURE__ */ new Set([
  "tactical",
  "king_safety",
  "pawn_structure",
  "piece_activity",
  "positional_judgment",
  "endgame_technique",
  "practical_time"
]);
var SEVERITIES = /* @__PURE__ */ new Set(["low", "medium", "high"]);
var ANALYSIS_BACKENDS = /* @__PURE__ */ new Set(["claude", "ollama"]);
var SETTING_DEFAULTS = Object.freeze({
  display_name: "",
  cat_avatar: "orange-tabby",
  chesscom_username: "lastautumnleaf1",
  engine_skill_level: "10",
  theme: "cat",
  daily_goal: "3",
  rated_practice: "false",
  preview_depth: "3",
  freeplay_persona: "tabby",
  freeplay_time_control: "5|0",
  freeplay_color: "random"
});
var SETTING_KEYS = new Set(Object.keys(SETTING_DEFAULTS));
function assertDb(db2) {
  if (!db2 || typeof db2.execute !== "function" || typeof db2.run !== "function" || typeof db2.query !== "function") {
    throw new TypeError("db must be a CapacitorSQLite connection.");
  }
}
function validateSessionHeader(summary) {
  if (!summary || typeof summary !== "object") throw new TypeError("summary must be an object.");
  if (typeof summary.id !== "string" || !summary.id.trim()) throw new TypeError("summary.id must be a non-empty string.");
  if (!ALLOWED_MODES.has(summary.mode)) throw new RangeError(`Unsupported game mode: ${summary.mode}`);
  if (!Array.isArray(summary.moves)) throw new TypeError("summary.moves must be an array.");
}
function normalizeNullableInteger(value, fieldName) {
  if (value === null || value === void 0) return null;
  if (!Number.isInteger(value)) throw new TypeError(`${fieldName} must be an integer or null.`);
  return value;
}
function normalizeNullableText(value, fieldName) {
  if (value === null || value === void 0) return null;
  if (typeof value !== "string") throw new TypeError(`${fieldName} must be a string or null.`);
  return value;
}
function normalizeMateFlag(value) {
  if (value === true || value === 1) return 1;
  if (value === false || value === 0 || value === null || value === void 0) return 0;
  throw new TypeError("move.is_mate_score must be 0, 1, boolean, null, or undefined.");
}
function validateMove(move, gameId) {
  if (!move || typeof move !== "object") throw new TypeError("Each move must be an object.");
  if (move.game_id !== gameId) {
    throw new Error(`Move game_id ${move.game_id} does not match session id ${gameId}.`);
  }
  if (!Number.isInteger(move.ply_number) || move.ply_number < 1) {
    throw new TypeError("move.ply_number must be a positive integer.");
  }
  for (const field of ["fen_before", "move_played", "timestamp"]) {
    if (typeof move[field] !== "string" || !move[field]) {
      throw new TypeError(`move.${field} must be a non-empty string.`);
    }
  }
  normalizeNullableInteger(move.eval_cp_before, "move.eval_cp_before");
  normalizeNullableInteger(move.eval_cp_after, "move.eval_cp_after");
  normalizeNullableText(move.best_move, "move.best_move");
  normalizeNullableText(move.principal_variation, "move.principal_variation");
  normalizeMateFlag(move.is_mate_score);
  if (move.stockfish_response !== null && move.stockfish_response !== void 0 && typeof move.stockfish_response !== "string") {
    throw new TypeError("move.stockfish_response must be a string or null.");
  }
}
function timestampSourceFor(move, mode) {
  const expected = mode === "imported" ? "posthoc_analysis" : "live_recorded";
  const value = move.timestamp_source ?? expected;
  if (value !== expected) {
    throw new Error(`move.timestamp_source must be ${expected} for mode=${mode}.`);
  }
  return value;
}
async function withTransaction(db2, operation) {
  const usesNativeTransactionApi = typeof db2.beginTransaction === "function" && typeof db2.commitTransaction === "function" && typeof db2.rollbackTransaction === "function";
  if (usesNativeTransactionApi) await db2.beginTransaction();
  else await db2.execute("BEGIN IMMEDIATE");
  try {
    const transactionDb = usesNativeTransactionApi ? {
      run: (statement, values = []) => db2.run(statement, values, false),
      execute: (statements) => db2.execute(statements, false),
      query: db2.query.bind(db2)
    } : db2;
    const result = await operation(transactionDb);
    if (usesNativeTransactionApi) await db2.commitTransaction();
    else await db2.execute("COMMIT");
    return result;
  } catch (error) {
    try {
      if (usesNativeTransactionApi) await db2.rollbackTransaction();
      else await db2.execute("ROLLBACK");
    } catch {
    }
    throw error;
  }
}
async function ensureMoveAnalysisColumns(db2) {
  const res = await db2.query("PRAGMA table_info(moves)");
  const columns = new Set((res.values || []).map((column) => column.name));
  const hadLegacyEval = columns.has("eval_cp");
  const additions = [
    ["eval_cp_before", "INTEGER NULL"],
    ["eval_cp_after", "INTEGER NULL"],
    ["best_move", "TEXT NULL"],
    ["principal_variation", "TEXT NULL"],
    ["is_mate_score", "INTEGER NOT NULL DEFAULT 0 CHECK(is_mate_score IN (0,1))"]
  ];
  for (const [name, sqlType] of additions) {
    if (!columns.has(name)) {
      await db2.execute(`ALTER TABLE moves ADD COLUMN ${name} ${sqlType}`);
      columns.add(name);
    }
  }
  if (hadLegacyEval) {
    await db2.execute("UPDATE moves SET eval_cp_before = eval_cp WHERE eval_cp_before IS NULL AND eval_cp IS NOT NULL");
  }
}
async function ensureGameStatusColumn(db2) {
  const res = await db2.query("PRAGMA table_info(games)");
  const columns = new Set((res.values || []).map((column) => column.name));
  if (!columns.has("status")) {
    await db2.execute(`ALTER TABLE games ADD COLUMN status TEXT NOT NULL DEFAULT 'completed'
      CHECK(status IN ('queued','in_progress','completed','analyzed'))`);
  }
}
async function ensureImportColumns(db2) {
  const gameRes = await db2.query("PRAGMA table_info(games)");
  const gameColumns = new Set((gameRes.values || []).map((column) => column.name));
  const gameAdditions = [
    ["import_source", "TEXT NULL"],
    ["external_game_id", "TEXT NULL"],
    ["player_color", "TEXT NULL CHECK(player_color IN ('white','black'))"],
    ["white_player", "TEXT NULL"],
    ["black_player", "TEXT NULL"],
    ["analysis_engine", "TEXT NULL"],
    ["analysis_depth", "INTEGER NULL"]
  ];
  for (const [name, type] of gameAdditions) {
    if (!gameColumns.has(name)) await db2.execute(`ALTER TABLE games ADD COLUMN ${name} ${type}`);
  }
  const moveRes = await db2.query("PRAGMA table_info(moves)");
  const moveColumns = new Set((moveRes.values || []).map((column) => column.name));
  if (!moveColumns.has("timestamp_source")) {
    await db2.execute(`ALTER TABLE moves ADD COLUMN timestamp_source TEXT NOT NULL DEFAULT 'live_recorded'
      CHECK(timestamp_source IN ('live_recorded','posthoc_analysis'))`);
  }
  await db2.execute(`CREATE UNIQUE INDEX IF NOT EXISTS idx_games_import_identity
    ON games(import_source, external_game_id)
    WHERE import_source IS NOT NULL AND external_game_id IS NOT NULL`);
}
async function ensureWeaknessClassificationColumn(db2) {
  const res = await db2.query("PRAGMA table_info(weakness_tags)");
  const columns = new Set((res.values || []).map((column) => column.name));
  if (!columns.has("classification_id")) {
    await db2.execute("ALTER TABLE weakness_tags ADD COLUMN classification_id INTEGER NULL REFERENCES move_classifications(id)");
  }
}
async function ensureM10ColumnsAndTables(db2) {
  const gameRes = await db2.query("PRAGMA table_info(games)");
  const gameColumns = new Set((gameRes.values || []).map((column) => column.name));
  const gameAdditions = [
    ["assistance_level", "TEXT NOT NULL DEFAULT 'none' CHECK(assistance_level IN ('none','preview','hints','full'))"],
    ["hint_count", "INTEGER NOT NULL DEFAULT 0"],
    ["takeback_count", "INTEGER NOT NULL DEFAULT 0"],
    ["time_control", "TEXT NULL"],
    ["persona", "TEXT NULL"]
  ];
  for (const [name, type] of gameAdditions) {
    if (!gameColumns.has(name)) await db2.execute(`ALTER TABLE games ADD COLUMN ${name} ${type}`);
  }
  await db2.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS seed_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id TEXT NOT NULL REFERENCES games(id),
      accuracy_component REAL NOT NULL,
      motif_component REAL NOT NULL,
      hint_penalty REAL NOT NULL,
      total_score REAL NOT NULL,
      computed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS daily_stats (
      date TEXT PRIMARY KEY,
      sessions_completed INTEGER NOT NULL DEFAULT 0,
      goal_target INTEGER NOT NULL DEFAULT 3,
      goal_met INTEGER NOT NULL DEFAULT 0 CHECK(goal_met IN (0,1)),
      total_score REAL NOT NULL DEFAULT 0,
      streak_day_counted INTEGER NOT NULL DEFAULT 0 CHECK(streak_day_counted IN (0,1))
    );
    CREATE TABLE IF NOT EXISTS streak_state (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      current_streak INTEGER NOT NULL DEFAULT 0,
      longest_streak INTEGER NOT NULL DEFAULT 0,
      freezes_remaining INTEGER NOT NULL DEFAULT 2,
      freezes_month TEXT NULL,
      last_counted_date TEXT NULL
    );
    CREATE TABLE IF NOT EXISTS category_mastery (
      category TEXT PRIMARY KEY CHECK(category IN (
        'tactical',
        'king_safety',
        'pawn_structure',
        'piece_activity',
        'positional_judgment',
        'endgame_technique',
        'practical_time'
      )),
      mastery_level INTEGER NOT NULL DEFAULT 0 CHECK(mastery_level BETWEEN 0 AND 5),
      last_practiced_at TEXT NULL,
      decay_checked_at TEXT NULL
    );
    CREATE TABLE IF NOT EXISTS hint_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id TEXT NOT NULL REFERENCES games(id),
      fen TEXT NOT NULL,
      tier TEXT NOT NULL CHECK(tier IN ('warm','warmer','hot')),
      detector TEXT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_seed_scores_game_id ON seed_scores(game_id);
    CREATE INDEX IF NOT EXISTS idx_hint_logs_game_id ON hint_logs(game_id);
  `);
}
async function insertMoves(db2, summary) {
  const insertMoveSql = `
    INSERT INTO moves (
      game_id,
      ply_number,
      fen_before,
      move_played,
      eval_cp_before,
      eval_cp_after,
      best_move,
      principal_variation,
      is_mate_score,
      stockfish_response,
      timestamp,
      timestamp_source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  for (const [index, move] of summary.moves.entries()) {
    validateMove(move, summary.id);
    if (move.ply_number !== index + 1) {
      throw new Error(`Expected ply_number ${index + 1}, received ${move.ply_number}.`);
    }
    await db2.run(
      insertMoveSql,
      [
        summary.id,
        move.ply_number,
        move.fen_before,
        move.move_played,
        normalizeNullableInteger(move.eval_cp_before, "move.eval_cp_before"),
        normalizeNullableInteger(move.eval_cp_after, "move.eval_cp_after"),
        normalizeNullableText(move.best_move, "move.best_move"),
        normalizeNullableText(move.principal_variation, "move.principal_variation"),
        normalizeMateFlag(move.is_mate_score),
        move.stockfish_response ?? null,
        move.timestamp,
        timestampSourceFor(move, summary.mode)
      ]
    );
  }
}
async function initDb(path) {
  if (typeof path !== "string" || !path.trim()) throw new TypeError("path must be a non-empty string.");
  const sqlite = new SQLiteConnection(CapacitorSQLite);
  const db2 = await sqlite.createConnection(path, false, "no-encryption", 1, false);
  await db2.open();
  await db2.execute("PRAGMA foreign_keys = ON;");
  const statements = SCHEMA_SQL.split(";").map((s) => s.trim()).filter((s) => s.length > 0);
  for (const statement of statements) {
    await db2.execute(statement + ";");
  }
  await ensureGameStatusColumn(db2);
  await ensureMoveAnalysisColumns(db2);
  await ensureWeaknessClassificationColumn(db2);
  await ensureImportColumns(db2);
  await ensureM10ColumnsAndTables(db2);
  return db2;
}
async function saveGameSession(db2, summary) {
  assertDb(db2);
  validateSessionHeader(summary);
  const insertGameSql = `
    INSERT INTO games (
      id, date, mode, status, result, seeded_weakness, seed_puzzle_id, start_fen, current_fen,
      import_source, external_game_id, player_color, white_player, black_player,
      analysis_engine, analysis_depth,
      assistance_level, hint_count, takeback_count, time_control, persona
    ) VALUES (?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const date = summary.date ?? summary.moves[0]?.timestamp ?? (/* @__PURE__ */ new Date()).toISOString();
  return withTransaction(db2, async (transactionDb) => {
    await transactionDb.run(insertGameSql, [
      summary.id,
      date,
      summary.mode,
      summary.result ?? null,
      summary.seeded_weakness ?? null,
      summary.seed_puzzle_id ?? null,
      summary.start_fen ?? null,
      summary.current_fen ?? null,
      summary.import_source ?? null,
      summary.external_game_id ?? null,
      summary.player_color ?? null,
      summary.white_player ?? null,
      summary.black_player ?? null,
      summary.analysis_engine ?? null,
      summary.analysis_depth ?? null,
      summary.assistance_level ?? "none",
      summary.hint_count ?? 0,
      summary.takeback_count ?? 0,
      summary.time_control ?? null,
      summary.persona ?? null
    ]);
    await insertMoves(transactionDb, summary);
    return summary.id;
  });
}
function validateQueuedGame(game) {
  if (!game || typeof game !== "object") throw new TypeError("game must be an object.");
  if (typeof game.id !== "string" || !game.id) throw new TypeError("game.id must be a non-empty string.");
  if (typeof game.start_fen !== "string" || !game.start_fen) throw new TypeError("game.start_fen must be a non-empty string.");
}
async function createQueuedGames(db2, games) {
  assertDb(db2);
  if (!Array.isArray(games) || games.length === 0) {
    throw new TypeError("games must be a non-empty array.");
  }
  games.forEach(validateQueuedGame);
  const insertSql = `
    INSERT INTO games (
      id, date, mode, status, result, seeded_weakness, seed_puzzle_id, start_fen, current_fen
    ) VALUES (?, ?, 'practice', 'queued', NULL, ?, ?, ?, ?)
  `;
  return withTransaction(db2, async (transactionDb) => {
    const ids = [];
    for (const game of games) {
      await transactionDb.run(insertSql, [
        game.id,
        game.date ?? (/* @__PURE__ */ new Date()).toISOString(),
        game.seeded_weakness ?? null,
        game.seed_puzzle_id ?? null,
        game.start_fen,
        game.start_fen
      ]);
      ids.push(game.id);
    }
    return ids;
  });
}
async function createQueuedGame(db2, game) {
  const ids = await createQueuedGames(db2, [game]);
  return ids[0];
}
async function getGameStatus(db2, gameId) {
  assertDb(db2);
  if (typeof gameId !== "string" || !gameId) throw new TypeError("gameId must be a non-empty string.");
  const res = await db2.query("SELECT status FROM games WHERE id = ?", [gameId]);
  if (!res.values || res.values.length === 0) throw new Error(`Game not found: ${gameId}`);
  return res.values[0].status;
}
async function transitionGameStatus(db2, gameId, nextStatus) {
  const current = await getGameStatus(db2, gameId);
  const expected = SESSION_TRANSITIONS[current];
  if (nextStatus !== expected) {
    throw new Error(`Invalid game status transition: ${current} \u2192 ${nextStatus}. Expected ${expected ?? "no further transition"}.`);
  }
  const result = await db2.run("UPDATE games SET status = ? WHERE id = ? AND status = ?", [nextStatus, gameId, current]);
  if (Number(result.changes?.changes) !== 1) throw new Error(`Game status changed concurrently: ${gameId}`);
  return nextStatus;
}
async function completeGameSession(db2, summary) {
  assertDb(db2);
  validateSessionHeader(summary);
  const date = summary.moves[0]?.timestamp ?? (/* @__PURE__ */ new Date()).toISOString();
  return withTransaction(db2, async (transactionDb) => {
    const result = await transactionDb.run(`
      UPDATE games
      SET date = ?, mode = ?, status = 'completed', result = ?,
          seeded_weakness = ?, seed_puzzle_id = ?, start_fen = ?, current_fen = ?,
          assistance_level = ?, hint_count = ?, takeback_count = ?, time_control = ?, persona = ?
      WHERE id = ? AND status = 'in_progress'
    `, [
      date,
      summary.mode,
      summary.result ?? null,
      summary.seeded_weakness ?? null,
      summary.seed_puzzle_id ?? null,
      summary.start_fen ?? null,
      summary.current_fen ?? null,
      summary.assistance_level ?? "none",
      summary.hint_count ?? 0,
      summary.takeback_count ?? 0,
      summary.time_control ?? null,
      summary.persona ?? null,
      summary.id
    ]);
    if (Number(result.changes?.changes) !== 1) {
      const res = await transactionDb.query("SELECT status FROM games WHERE id = ?", [summary.id]);
      const current = res.values && res.values.length > 0 ? res.values[0].status : null;
      throw new Error(`Cannot complete game ${summary.id} from status ${current ?? "missing"}.`);
    }
    await insertMoves(transactionDb, summary);
    return summary.id;
  });
}
async function getGameHistory(db2, { limit, weaknessCategory } = {}) {
  assertDb(db2);
  if (limit !== void 0 && (!Number.isInteger(limit) || limit < 1)) {
    throw new RangeError("limit must be a positive integer when provided.");
  }
  if (weaknessCategory !== void 0 && weaknessCategory !== null && typeof weaknessCategory !== "string") {
    throw new TypeError("weaknessCategory must be a string, null, or undefined.");
  }
  const where = weaknessCategory === void 0 ? "" : weaknessCategory === null ? " WHERE seeded_weakness IS NULL" : " WHERE seeded_weakness = ?";
  const limitClause = limit === void 0 ? "" : " LIMIT ?";
  const sql = `
    SELECT id, date, mode, status, result, seeded_weakness, seed_puzzle_id, start_fen, current_fen,
           import_source, external_game_id, player_color, white_player, black_player,
           analysis_engine, analysis_depth,
           assistance_level, hint_count, takeback_count, time_control, persona
    FROM games
    ${where}
    ORDER BY date DESC, rowid DESC
    ${limitClause}
  `;
  const params = [];
  if (weaknessCategory !== void 0 && weaknessCategory !== null) params.push(weaknessCategory);
  if (limit !== void 0) params.push(limit);
  const gamesRes = await db2.query(sql, params);
  const games = gamesRes.values || [];
  const movesSql = `
    SELECT
      id, game_id, ply_number, fen_before, move_played, eval_cp_before,
      eval_cp_after, best_move, principal_variation, is_mate_score,
      stockfish_response, timestamp, timestamp_source
    FROM moves
    WHERE game_id = ?
    ORDER BY ply_number ASC, id ASC
  `;
  const result = [];
  for (const game of games) {
    const movesRes = await db2.query(movesSql, [game.id]);
    result.push({
      ...game,
      moves: (movesRes.values || []).map((move) => ({ ...move }))
    });
  }
  return result;
}
async function getGameById(db2, gameId) {
  assertDb(db2);
  if (typeof gameId !== "string" || !gameId) throw new TypeError("gameId must be a non-empty string.");
  const gameRes = await db2.query(`
    SELECT id, date, mode, status, result, seeded_weakness, seed_puzzle_id, start_fen, current_fen,
           import_source, external_game_id, player_color, white_player, black_player,
           analysis_engine, analysis_depth,
           assistance_level, hint_count, takeback_count, time_control, persona
    FROM games WHERE id = ?
  `, [gameId]);
  if (!gameRes.values || gameRes.values.length === 0) throw new Error(`Game not found: ${gameId}`);
  const game = gameRes.values[0];
  const movesRes = await db2.query(`
    SELECT id, game_id, ply_number, fen_before, move_played, eval_cp_before,
           eval_cp_after, best_move, principal_variation, is_mate_score,
           stockfish_response, timestamp, timestamp_source
    FROM moves WHERE game_id = ? ORDER BY ply_number ASC, id ASC
  `, [gameId]);
  const moves = movesRes.values || [];
  return { ...game, moves: moves.map((move) => ({ ...move })) };
}
async function saveWeaknessTags(db2, moveId, tags) {
  assertDb(db2);
  if (!Number.isInteger(moveId) || moveId < 1) throw new TypeError("moveId must be a positive integer.");
  const normalizedTags = Array.isArray(tags) ? tags : [tags];
  if (normalizedTags.length === 0 || normalizedTags.some((tag) => !tag || typeof tag !== "object")) {
    throw new TypeError("tags must contain one or more tag objects.");
  }
  const insertTagSql = `
    INSERT INTO weakness_tags (move_id, category, severity, source)
    VALUES (?, ?, ?, ?)
  `;
  return withTransaction(db2, async (transactionDb) => {
    const ids = [];
    for (const tag of normalizedTags) {
      if (typeof tag.category !== "string" || !tag.category) throw new TypeError("tag.category must be a non-empty string.");
      if (typeof tag.severity !== "string" || !tag.severity) throw new TypeError("tag.severity must be a non-empty string.");
      const source = tag.source ?? "ai_classification";
      if (typeof source !== "string" || !source) throw new TypeError("tag.source must be a non-empty string.");
      const result = await transactionDb.run(insertTagSql, [moveId, tag.category, tag.severity, source]);
      ids.push(Number(result.changes?.lastId));
    }
    return ids;
  });
}
function validateProvenance(provenance) {
  if (!provenance || typeof provenance !== "object") throw new TypeError("provenance must be an object.");
  for (const field of ["model_used", "prompt_version", "prompt_hash", "analysis_timestamp"]) {
    if (typeof provenance[field] !== "string" || !provenance[field]) {
      throw new TypeError(`provenance.${field} must be a non-empty string.`);
    }
  }
  if (!ANALYSIS_BACKENDS.has(provenance.backend)) {
    throw new RangeError(`Unsupported analysis backend: ${provenance.backend}`);
  }
}
async function saveMoveClassification(db2, moveId, result) {
  assertDb(db2);
  if (!Number.isInteger(moveId) || moveId < 1) throw new TypeError("moveId must be a positive integer.");
  if (!result || typeof result !== "object") throw new TypeError("result must be an object.");
  if (!["classified", "unclassified"].includes(result.status)) {
    throw new RangeError(`Unsupported classification status: ${result.status}`);
  }
  if (!Number.isInteger(result.attempts) || result.attempts < 1 || result.attempts > 2) {
    throw new RangeError("result.attempts must be 1 or 2.");
  }
  validateProvenance(result.provenance);
  const value = result.value;
  if (result.status === "classified") {
    if (!value || typeof value !== "object") throw new TypeError("A classified result requires value.");
    if (!WEAKNESS_CATEGORIES2.has(value.category)) throw new RangeError(`Unknown weakness category: ${value.category}`);
    if (!SEVERITIES.has(value.severity)) throw new RangeError(`Unknown severity: ${value.severity}`);
    if (typeof value.rationale !== "string" || !value.rationale) throw new TypeError("value.rationale must be a non-empty string.");
  } else if (typeof result.error !== "string" || !result.error) {
    throw new TypeError("An unclassified result requires a non-empty error.");
  }
  return withTransaction(db2, async (transactionDb) => {
    const moveRes = await transactionDb.query("SELECT id FROM moves WHERE id = ?", [moveId]);
    if (!moveRes.values || moveRes.values.length === 0) throw new Error(`Move not found: ${moveId}`);
    await transactionDb.run("UPDATE move_classifications SET is_current = 0 WHERE move_id = ? AND is_current = 1", [moveId]);
    const inserted = await transactionDb.run(`
      INSERT INTO move_classifications (
        move_id, status, category, severity, rationale, error, attempts,
        model_used, backend, prompt_version, prompt_hash, analysis_timestamp, is_current
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `, [
      moveId,
      result.status,
      result.status === "classified" ? value.category : null,
      result.status === "classified" ? value.severity : null,
      result.status === "classified" ? value.rationale : null,
      result.error ?? null,
      result.attempts,
      result.provenance.model_used,
      result.provenance.backend,
      result.provenance.prompt_version,
      result.provenance.prompt_hash,
      result.provenance.analysis_timestamp
    ]);
    const classificationId = Number(inserted.changes?.lastId);
    if (result.status === "classified") {
      await transactionDb.run(`
        INSERT INTO weakness_tags (move_id, category, severity, source, classification_id)
        VALUES (?, ?, ?, 'ai_classification', ?)
      `, [moveId, value.category, value.severity, classificationId]);
    }
    return classificationId;
  });
}
async function getMoveClassifications(db2, moveId, { currentOnly = false } = {}) {
  assertDb(db2);
  if (!Number.isInteger(moveId) || moveId < 1) throw new TypeError("moveId must be a positive integer.");
  const sql = `
    SELECT id, move_id, status, category, severity, rationale, error, attempts,
           model_used, backend, prompt_version, prompt_hash, analysis_timestamp, is_current
    FROM move_classifications
    WHERE move_id = ? ${currentOnly ? "AND is_current = 1" : ""}
    ORDER BY id ASC
  `;
  const res = await db2.query(sql, [moveId]);
  return (res.values || []).map((row) => ({ ...row }));
}
async function getWeaknessTally(db2, { sinceGameId } = {}) {
  assertDb(db2);
  let where = "WHERE (wt.classification_id IS NULL OR mc.is_current = 1) AND g.assistance_level = 'none'";
  let params = [];
  if (sinceGameId !== void 0) {
    if (typeof sinceGameId !== "string" || !sinceGameId) {
      throw new TypeError("sinceGameId must be a non-empty string when provided.");
    }
    const anchorRes = await db2.query("SELECT date, rowid AS insertion_order FROM games WHERE id = ?", [sinceGameId]);
    if (!anchorRes.values || anchorRes.values.length === 0) throw new Error(`Game not found: ${sinceGameId}`);
    const anchor = anchorRes.values[0];
    if (anchor.date === null) {
      where += " AND g.rowid >= ?";
      params = [anchor.insertion_order];
    } else {
      where += " AND (g.date > ? OR (g.date = ? AND g.rowid >= ?))";
      params = [anchor.date, anchor.date, anchor.insertion_order];
    }
  }
  const sql = `
    SELECT wt.category AS category, COUNT(*) AS count
    FROM weakness_tags wt
    JOIN moves m ON m.id = wt.move_id
    JOIN games g ON g.id = m.game_id
    LEFT JOIN move_classifications mc ON mc.id = wt.classification_id
    ${where}
    GROUP BY wt.category
    ORDER BY count DESC, wt.category ASC
  `;
  const res = await db2.query(sql, params);
  return (res.values || []).map((row) => ({ category: row.category, count: Number(row.count) }));
}
async function getProfileStats(db2, { recentLimit = 10 } = {}) {
  assertDb(db2);
  if (!Number.isInteger(recentLimit) || recentLimit < 1 || recentLimit > 50) {
    throw new RangeError("recentLimit must be an integer from 1 to 50.");
  }
  const totalsRes = await db2.query(`
    SELECT
      COUNT(*) AS total_sessions,
      COALESCE(SUM(move_count), 0) AS total_moves
    FROM (
      SELECT g.id, COUNT(m.id) AS move_count
      FROM games g
      LEFT JOIN moves m ON m.game_id = g.id
      WHERE g.status IN ('completed', 'analyzed')
      GROUP BY g.id
    )
  `);
  const totals = totalsRes.values?.[0] ?? { total_sessions: 0, total_moves: 0 };
  const recentRes = await db2.query(`
    SELECT g.id, g.date, g.seeded_weakness, g.result, g.status, g.assistance_level, g.persona, COUNT(m.id) AS move_count
    FROM games g
    LEFT JOIN moves m ON m.game_id = g.id
    WHERE g.status IN ('completed', 'analyzed')
    GROUP BY g.id
    ORDER BY COALESCE(g.date, '') DESC, g.rowid DESC
    LIMIT ?
  `, [recentLimit]);
  return {
    totalSessions: Number(totals.total_sessions ?? 0),
    totalMoves: Number(totals.total_moves ?? 0),
    weaknessTally: await getWeaknessTally(db2),
    recentSessions: (recentRes.values || []).map((row) => ({
      ...row,
      move_count: Number(row.move_count ?? 0)
    }))
  };
}
async function getSettings(db2) {
  assertDb(db2);
  const res = await db2.query("SELECT key, value FROM settings");
  const settings2 = { ...SETTING_DEFAULTS };
  for (const row of res.values || []) {
    if (SETTING_KEYS.has(row.key)) settings2[row.key] = String(row.value);
  }
  return settings2;
}
async function setSetting(db2, key, value) {
  assertDb(db2);
  if (!SETTING_KEYS.has(key)) throw new RangeError(`Unknown setting: ${key}`);
  const normalized = String(value ?? "").trim();
  if (key === "engine_skill_level") {
    const level = Number(normalized);
    if (!Number.isInteger(level) || level < 0 || level > 20) {
      throw new RangeError("engine_skill_level must be an integer from 0 to 20.");
    }
  }
  if (key === "theme" && !["cat", "panda", "black-cat", "bunny", "fox", "corgi", "koala", "raccoon", "otter", "red-panda"].includes(normalized)) {
    throw new RangeError("Unknown animal theme.");
  }
  if (key === "cat_avatar" && !["orange-tabby", "tuxedo", "calico", "black-cat"].includes(normalized)) {
    throw new RangeError("Unknown cat avatar.");
  }
  await db2.run(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `, [key, normalized]);
  return normalized;
}
async function saveSeedScore(db2, { gameId, accuracyComponent, motifComponent, hintPenalty, totalScore, computedAt = (/* @__PURE__ */ new Date()).toISOString() }) {
  assertDb(db2);
  if (typeof gameId !== "string" || !gameId) throw new TypeError("gameId must be a non-empty string.");
  return withTransaction(db2, async (transactionDb) => {
    const res = await transactionDb.run(`
      INSERT INTO seed_scores (game_id, accuracy_component, motif_component, hint_penalty, total_score, computed_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [gameId, Number(accuracyComponent), Number(motifComponent), Number(hintPenalty), Number(totalScore), computedAt]);
    return Number(res.changes?.lastId);
  });
}
async function getSeedScore(db2, gameId) {
  assertDb(db2);
  if (typeof gameId !== "string" || !gameId) throw new TypeError("gameId must be a non-empty string.");
  const res = await db2.query("SELECT * FROM seed_scores WHERE game_id = ? ORDER BY id DESC LIMIT 1", [gameId]);
  return res.values && res.values.length > 0 ? { ...res.values[0] } : null;
}
async function saveHintLog(db2, { gameId, fen, tier, detector = null, createdAt = (/* @__PURE__ */ new Date()).toISOString() }) {
  assertDb(db2);
  if (typeof gameId !== "string" || !gameId) throw new TypeError("gameId must be a non-empty string.");
  if (typeof fen !== "string" || !fen) throw new TypeError("fen must be a non-empty string.");
  if (!["warm", "warmer", "hot"].includes(tier)) throw new RangeError(`Invalid tier: ${tier}`);
  return withTransaction(db2, async (transactionDb) => {
    const res = await transactionDb.run(`
      INSERT INTO hint_logs (game_id, fen, tier, detector, created_at)
      VALUES (?, ?, ?, ?, ?)
    `, [gameId, fen, tier, detector, createdAt]);
    return Number(res.changes?.lastId);
  });
}
async function getHintLogs(db2, gameId) {
  assertDb(db2);
  if (typeof gameId !== "string" || !gameId) throw new TypeError("gameId must be a non-empty string.");
  const res = await db2.query("SELECT * FROM hint_logs WHERE game_id = ? ORDER BY id ASC", [gameId]);
  return (res.values || []).map((row) => ({ ...row }));
}
async function getDailyStats(db2, date) {
  assertDb(db2);
  if (typeof date !== "string" || !date) throw new TypeError("date must be a non-empty string (YYYY-MM-DD).");
  const res = await db2.query("SELECT * FROM daily_stats WHERE date = ?", [date]);
  if (!res.values || res.values.length === 0) return null;
  const row = res.values[0];
  return {
    date: row.date,
    sessionsCompleted: Number(row.sessions_completed),
    goalTarget: Number(row.goal_target),
    goalMet: Boolean(row.goal_met),
    totalScore: Number(row.total_score),
    streakDayCounted: Boolean(row.streak_day_counted)
  };
}
async function getRecentDailyStats(db2, { limitDays = 30 } = {}) {
  assertDb(db2);
  const res = await db2.query("SELECT * FROM daily_stats ORDER BY date DESC LIMIT ?", [limitDays]);
  return (res.values || []).map((row) => ({
    date: row.date,
    sessionsCompleted: Number(row.sessions_completed),
    goalTarget: Number(row.goal_target),
    goalMet: Boolean(row.goal_met),
    totalScore: Number(row.total_score),
    streakDayCounted: Boolean(row.streak_day_counted)
  }));
}
async function recordDailySession(db2, { date, targetGoal = 3, sessionScore = 0, isCountedStreakDay = 0 }) {
  assertDb(db2);
  return withTransaction(db2, async (transactionDb) => {
    const res = await transactionDb.query("SELECT * FROM daily_stats WHERE date = ?", [date]);
    const existing = res.values && res.values.length > 0 ? res.values[0] : null;
    if (!existing) {
      const completed = 1;
      const met = completed >= targetGoal ? 1 : 0;
      await transactionDb.run(`
        INSERT INTO daily_stats (date, sessions_completed, goal_target, goal_met, total_score, streak_day_counted)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [date, completed, targetGoal, met, Number(sessionScore), isCountedStreakDay ? 1 : 0]);
    } else {
      const completed = Number(existing.sessions_completed) + 1;
      const met = completed >= Number(existing.goal_target) ? 1 : 0;
      const totalScore = Number(existing.total_score) + Number(sessionScore);
      const streakCounted = existing.streak_day_counted || isCountedStreakDay ? 1 : 0;
      await transactionDb.run(`
        UPDATE daily_stats
        SET sessions_completed = ?, goal_met = ?, total_score = ?, streak_day_counted = ?
        WHERE date = ?
      `, [completed, met, totalScore, streakCounted, date]);
    }
  });
}
async function getStreakState(db2) {
  assertDb(db2);
  const res = await db2.query("SELECT * FROM streak_state WHERE id = 1");
  if (!res.values || res.values.length === 0) {
    return {
      currentStreak: 0,
      longestStreak: 0,
      freezesRemaining: 2,
      freezesMonth: (/* @__PURE__ */ new Date()).toISOString().slice(0, 7),
      lastCountedDate: null
    };
  }
  const row = res.values[0];
  return {
    currentStreak: Number(row.current_streak),
    longestStreak: Number(row.longest_streak),
    freezesRemaining: Number(row.freezes_remaining),
    freezesMonth: row.freezes_month,
    lastCountedDate: row.last_counted_date
  };
}
async function updateStreakState(db2, { currentStreak, longestStreak, freezesRemaining, freezesMonth, lastCountedDate }) {
  assertDb(db2);
  return withTransaction(db2, async (transactionDb) => {
    await transactionDb.run(`
      INSERT INTO streak_state (id, current_streak, longest_streak, freezes_remaining, freezes_month, last_counted_date)
      VALUES (1, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        current_streak = excluded.current_streak,
        longest_streak = excluded.longest_streak,
        freezes_remaining = excluded.freezes_remaining,
        freezes_month = excluded.freezes_month,
        last_counted_date = excluded.last_counted_date
    `, [currentStreak, longestStreak, freezesRemaining, freezesMonth, lastCountedDate]);
  });
}
async function getCategoryMastery(db2) {
  assertDb(db2);
  const res = await db2.query("SELECT * FROM category_mastery");
  const masteryMap = {};
  for (const cat of WEAKNESS_CATEGORIES2) {
    masteryMap[cat] = {
      category: cat,
      masteryLevel: 0,
      lastPracticedAt: null,
      decayCheckedAt: null
    };
  }
  for (const row of res.values || []) {
    masteryMap[row.category] = {
      category: row.category,
      masteryLevel: Number(row.mastery_level),
      lastPracticedAt: row.last_practiced_at,
      decayCheckedAt: row.decay_checked_at
    };
  }
  return masteryMap;
}
async function updateCategoryMastery(db2, { category, masteryLevel, lastPracticedAt, decayCheckedAt }) {
  assertDb(db2);
  if (!WEAKNESS_CATEGORIES2.has(category)) throw new RangeError(`Unknown weakness category: ${category}`);
  return withTransaction(db2, async (transactionDb) => {
    await transactionDb.run(`
      INSERT INTO category_mastery (category, mastery_level, last_practiced_at, decay_checked_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(category) DO UPDATE SET
        mastery_level = excluded.mastery_level,
        last_practiced_at = excluded.last_practiced_at,
        decay_checked_at = excluded.decay_checked_at
    `, [category, Math.max(0, Math.min(5, Math.trunc(masteryLevel))), lastPracticedAt ?? null, decayCheckedAt ?? null]);
  });
}
async function clearAllUserData(db2) {
  await db2.execute("DELETE FROM hint_logs;");
  await db2.execute("DELETE FROM seed_scores;");
  await db2.execute("DELETE FROM weakness_tags;");
  await db2.execute("DELETE FROM move_classifications;");
  await db2.execute("DELETE FROM moves;");
  await db2.execute("DELETE FROM games;");
  await db2.execute("DELETE FROM settings;");
  await db2.execute("DELETE FROM daily_stats;");
  await db2.execute("DELETE FROM streak_state;");
  await db2.execute("DELETE FROM category_mastery;");
}
async function resetUserData(db2) {
  assertDb(db2);
  return withTransaction(db2, async (transactionDb) => {
    await clearAllUserData(transactionDb);
  });
}
async function exportDatabaseJson(db2) {
  assertDb(db2);
  const [
    settings2,
    games,
    moves,
    weakness_tags,
    move_classifications,
    seed_scores,
    daily_stats,
    streak_state,
    category_mastery,
    hint_logs
  ] = await Promise.all([
    db2.query("SELECT * FROM settings"),
    db2.query("SELECT * FROM games"),
    db2.query("SELECT * FROM moves"),
    db2.query("SELECT * FROM weakness_tags"),
    db2.query("SELECT * FROM move_classifications"),
    db2.query("SELECT * FROM seed_scores"),
    db2.query("SELECT * FROM daily_stats"),
    db2.query("SELECT * FROM streak_state"),
    db2.query("SELECT * FROM category_mastery"),
    db2.query("SELECT * FROM hint_logs")
  ]);
  return {
    version: 1,
    exported_at: (/* @__PURE__ */ new Date()).toISOString(),
    tables: {
      settings: settings2.values || [],
      games: games.values || [],
      moves: moves.values || [],
      weakness_tags: weakness_tags.values || [],
      move_classifications: move_classifications.values || [],
      seed_scores: seed_scores.values || [],
      daily_stats: daily_stats.values || [],
      streak_state: streak_state.values || [],
      category_mastery: category_mastery.values || [],
      hint_logs: hint_logs.values || []
    }
  };
}
async function importDatabaseJson(db2, payload) {
  assertDb(db2);
  if (!payload || typeof payload !== "object" || !payload.tables) {
    throw new TypeError("Invalid backup payload.");
  }
  return withTransaction(db2, async (transactionDb) => {
    await clearAllUserData(transactionDb);
    const t = payload.tables;
    if (Array.isArray(t.settings)) {
      for (const r of t.settings) {
        await transactionDb.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [r.key, r.value]);
      }
    }
    if (Array.isArray(t.games)) {
      const stmt = `
        INSERT INTO games (
          id, date, mode, status, result, seeded_weakness, seed_puzzle_id, start_fen, current_fen,
          import_source, external_game_id, player_color, white_player, black_player,
          analysis_engine, analysis_depth, assistance_level, hint_count, takeback_count, time_control, persona
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      for (const r of t.games) {
        await transactionDb.run(stmt, [
          r.id,
          r.date,
          r.mode,
          r.status,
          r.result,
          r.seeded_weakness,
          r.seed_puzzle_id,
          r.start_fen,
          r.current_fen,
          r.import_source,
          r.external_game_id,
          r.player_color,
          r.white_player,
          r.black_player,
          r.analysis_engine,
          r.analysis_depth,
          r.assistance_level ?? "none",
          r.hint_count ?? 0,
          r.takeback_count ?? 0,
          r.time_control ?? null,
          r.persona ?? null
        ]);
      }
    }
    if (Array.isArray(t.moves)) {
      const stmt = `
        INSERT INTO moves (
          id, game_id, ply_number, fen_before, move_played, eval_cp_before, eval_cp_after,
          best_move, principal_variation, is_mate_score, stockfish_response, timestamp, timestamp_source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      for (const r of t.moves) {
        await transactionDb.run(stmt, [
          r.id,
          r.game_id,
          r.ply_number,
          r.fen_before,
          r.move_played,
          r.eval_cp_before,
          r.eval_cp_after,
          r.best_move,
          r.principal_variation,
          r.is_mate_score,
          r.stockfish_response,
          r.timestamp,
          r.timestamp_source ?? "live_recorded"
        ]);
      }
    }
    if (Array.isArray(t.move_classifications)) {
      const stmt = `
        INSERT INTO move_classifications (
          id, move_id, status, category, severity, rationale, error, attempts,
          model_used, backend, prompt_version, prompt_hash, analysis_timestamp, is_current
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      for (const r of t.move_classifications) {
        await transactionDb.run(stmt, [
          r.id,
          r.move_id,
          r.status,
          r.category,
          r.severity,
          r.rationale,
          r.error,
          r.attempts,
          r.model_used,
          r.backend,
          r.prompt_version,
          r.prompt_hash,
          r.analysis_timestamp,
          r.is_current
        ]);
      }
    }
    if (Array.isArray(t.weakness_tags)) {
      const stmt = `
        INSERT INTO weakness_tags (id, move_id, category, severity, source, classification_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `;
      for (const r of t.weakness_tags) {
        await transactionDb.run(stmt, [r.id, r.move_id, r.category, r.severity, r.source, r.classification_id]);
      }
    }
    if (Array.isArray(t.seed_scores)) {
      const stmt = `
        INSERT INTO seed_scores (id, game_id, accuracy_component, motif_component, hint_penalty, total_score, computed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;
      for (const r of t.seed_scores) {
        await transactionDb.run(stmt, [r.id, r.game_id, r.accuracy_component, r.motif_component, r.hint_penalty, r.total_score, r.computed_at]);
      }
    }
    if (Array.isArray(t.daily_stats)) {
      const stmt = `
        INSERT INTO daily_stats (date, sessions_completed, goal_target, goal_met, total_score, streak_day_counted)
        VALUES (?, ?, ?, ?, ?, ?)
      `;
      for (const r of t.daily_stats) {
        await transactionDb.run(stmt, [r.date, r.sessions_completed, r.goal_target, r.goal_met, r.total_score, r.streak_day_counted]);
      }
    }
    if (Array.isArray(t.streak_state)) {
      const stmt = `
        INSERT INTO streak_state (id, current_streak, longest_streak, freezes_remaining, freezes_month, last_counted_date)
        VALUES (?, ?, ?, ?, ?, ?)
      `;
      for (const r of t.streak_state) {
        await transactionDb.run(stmt, [r.id, r.current_streak, r.longest_streak, r.freezes_remaining, r.freezes_month, r.last_counted_date]);
      }
    }
    if (Array.isArray(t.category_mastery)) {
      const stmt = `
        INSERT INTO category_mastery (category, mastery_level, last_practiced_at, decay_checked_at)
        VALUES (?, ?, ?, ?)
      `;
      for (const r of t.category_mastery) {
        await transactionDb.run(stmt, [r.category, r.mastery_level, r.last_practiced_at, r.decay_checked_at]);
      }
    }
    if (Array.isArray(t.hint_logs)) {
      const stmt = `
        INSERT INTO hint_logs (id, game_id, fen, tier, detector, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `;
      for (const r of t.hint_logs) {
        await transactionDb.run(stmt, [r.id, r.game_id, r.fen, r.tier, r.detector, r.created_at]);
      }
    }
    return true;
  });
}

// storage/mobilePuzzleDb.js
function normalizeThemeTags(themeTags = []) {
  return [...new Set(themeTags.filter((theme) => typeof theme === "string" && theme))];
}
function normalizeStepRange(stepRange = [0, Number.POSITIVE_INFINITY]) {
  if (!Array.isArray(stepRange) || stepRange.length !== 2) {
    throw new TypeError("stepRange must be [min, max].");
  }
  const [min, max] = stepRange;
  if (!Number.isFinite(min) || min < 0) throw new RangeError("stepRange minimum must be a non-negative finite number.");
  if (!(Number.isFinite(max) || max === Number.POSITIVE_INFINITY) || max < min) {
    throw new RangeError("stepRange maximum must be >= minimum.");
  }
  return [Math.trunc(min), max === Number.POSITIVE_INFINITY ? max : Math.trunc(max)];
}
function buildFilter(themeTags, stepRange) {
  const themes = normalizeThemeTags(themeTags);
  const [minSteps, maxSteps] = normalizeStepRange(stepRange);
  const clauses = ["p.step_count >= ?"];
  const params = [minSteps];
  if (maxSteps !== Number.POSITIVE_INFINITY) {
    clauses.push("p.step_count <= ?");
    params.push(maxSteps);
  }
  if (themes.length) {
    const placeholders = themes.map(() => "?").join(", ");
    clauses.push(`p.puzzle_id IN (SELECT puzzle_id FROM puzzle_themes WHERE theme IN (${placeholders}))`);
    params.push(...themes);
  }
  return { whereSql: clauses.join(" AND "), params };
}
function rowToPuzzle(row, themes) {
  const moves = row.moves.trim().split(/\s+/).filter(Boolean);
  return Object.freeze({
    PuzzleId: row.puzzle_id,
    FEN: row.fen,
    Moves: row.moves,
    Themes: themes.join(" "),
    Rating: row.rating,
    moves,
    themes: Object.freeze([...themes]),
    stepCount: row.step_count
  });
}
var MobileSqlitePuzzleLibrary = class {
  constructor(db2) {
    if (!db2) {
      throw new TypeError("db must be a capacitor sqlite connection object.");
    }
    this.db = db2;
  }
  async hydrate(row) {
    if (!row) return null;
    const res = await this.db.query(`
      SELECT theme
      FROM puzzle_themes
      WHERE puzzle_id = ?
      ORDER BY theme ASC
    `, [row.puzzle_id]);
    const themes = (res.values || []).map((item) => item.theme);
    return rowToPuzzle(row, themes);
  }
  async filter({ themeTags = [], stepRange = [0, Number.POSITIVE_INFINITY], limit = 1e3 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1e4) {
      throw new RangeError("limit must be an integer from 1 to 10000 for SQLite puzzle queries.");
    }
    const { whereSql, params } = buildFilter(themeTags, stepRange);
    const res = await this.db.query(`
      SELECT p.puzzle_id, p.fen, p.moves, p.rating, p.step_count
      FROM puzzles p
      WHERE ${whereSql}
      ORDER BY p.puzzle_id ASC
      LIMIT ?
    `, [...params, limit]);
    const rows = res.values || [];
    const puzzles = [];
    for (const row of rows) {
      puzzles.push(await this.hydrate(row));
    }
    return puzzles;
  }
  async sample({ themeTags = [], stepRange = [0, Number.POSITIVE_INFINITY] } = {}, random = Math.random) {
    const { whereSql, params } = buildFilter(themeTags, stepRange);
    const countRes = await this.db.query(`
      SELECT COUNT(*) AS count
      FROM puzzles p
      WHERE ${whereSql}
    `, params);
    const countRow = countRes.values?.[0];
    const count = countRow ? Number(countRow.count) : 0;
    if (count === 0) return null;
    const randomValue = Number(random());
    const bounded = Number.isFinite(randomValue) ? Math.max(0, Math.min(0.999999999999, randomValue)) : 0;
    const offset = Math.floor(bounded * count);
    const res = await this.db.query(`
      SELECT p.puzzle_id, p.fen, p.moves, p.rating, p.step_count
      FROM puzzles p
      WHERE ${whereSql}
      ORDER BY p.puzzle_id ASC
      LIMIT 1 OFFSET ?
    `, [...params, offset]);
    const row = res.values?.[0];
    return await this.hydrate(row);
  }
  async findLongest({ themeTags = [] } = {}) {
    const { whereSql, params } = buildFilter(themeTags, [0, Number.POSITIVE_INFINITY]);
    const res = await this.db.query(`
      SELECT p.puzzle_id, p.fen, p.moves, p.rating, p.step_count
      FROM puzzles p
      WHERE ${whereSql}
      ORDER BY p.step_count DESC, p.puzzle_id ASC
      LIMIT 1
    `, params);
    const row = res.values?.[0];
    return await this.hydrate(row);
  }
};

// storage/corpusBootstrap.js
var PUZZLE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS puzzles (
    puzzle_id TEXT PRIMARY KEY,
    fen TEXT NOT NULL,
    moves TEXT NOT NULL,
    rating INTEGER,
    step_count INTEGER NOT NULL CHECK(step_count > 0)
  )`,
  `CREATE TABLE IF NOT EXISTS puzzle_themes (
    theme TEXT NOT NULL,
    puzzle_id TEXT NOT NULL REFERENCES puzzles(puzzle_id) ON DELETE CASCADE,
    PRIMARY KEY (theme, puzzle_id)
  ) WITHOUT ROWID`,
  "CREATE INDEX IF NOT EXISTS idx_puzzles_step_count ON puzzles(step_count)",
  "CREATE INDEX IF NOT EXISTS idx_puzzle_themes_puzzle_id ON puzzle_themes(puzzle_id)",
  `CREATE TABLE IF NOT EXISTS corpus_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`
];
function assertDb2(db2) {
  if (!db2?.execute || !db2?.run || !db2?.query) {
    throw new TypeError("db must be an async SQLite connection.");
  }
}
async function ensureCorpusSchema(db2) {
  assertDb2(db2);
  await db2.execute("PRAGMA foreign_keys = ON;");
  for (const statement of PUZZLE_SCHEMA) await db2.execute(`${statement};`);
}
async function getCorpusStatus(db2) {
  assertDb2(db2);
  await ensureCorpusSchema(db2);
  const countRes = await db2.query("SELECT COUNT(*) AS count FROM puzzles");
  const metaRes = await db2.query("SELECT key, value FROM corpus_meta WHERE key IN ('corpus_version', 'corpus_sha256')");
  const meta = Object.fromEntries((metaRes.values || []).map((row) => [row.key, row.value]));
  return {
    populated: Number(countRes.values?.[0]?.count ?? 0) > 0,
    puzzleCount: Number(countRes.values?.[0]?.count ?? 0),
    version: meta.corpus_version ?? null,
    sha256: meta.corpus_sha256 ?? null
  };
}
function hex(bytes) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function readResponseBytes(response, onProgress) {
  if (!response.ok) throw new Error(`Corpus download failed with HTTP ${response.status}.`);
  const total = Number(response.headers.get("content-length") || 0);
  if (!response.body?.getReader) {
    const bytes2 = new Uint8Array(await response.arrayBuffer());
    onProgress?.({ phase: "download", loaded: bytes2.length, total, percent: total ? 100 : null });
    return bytes2;
  }
  const chunks = [];
  let loaded = 0;
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress?.({
      phase: "download",
      loaded,
      total,
      percent: total ? Math.min(100, Math.round(loaded / total * 100)) : null
    });
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
async function decompressGzip(bytes) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("This WebView does not support gzip decompression.");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
}
function validatePuzzle(record) {
  if (!record || typeof record !== "object") throw new Error("Corpus row must be an object.");
  for (const field of ["puzzleId", "fen", "moves"]) {
    if (typeof record[field] !== "string" || !record[field].trim()) {
      throw new Error(`Corpus row has an invalid ${field}.`);
    }
  }
  if (!Number.isInteger(record.stepCount) || record.stepCount < 1) {
    throw new Error(`Corpus row ${record.puzzleId} has an invalid stepCount.`);
  }
  if (!Array.isArray(record.themes) || record.themes.some((theme) => typeof theme !== "string" || !theme)) {
    throw new Error(`Corpus row ${record.puzzleId} has invalid themes.`);
  }
}
async function importRows(db2, text, manifest, onProgress) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length !== manifest.puzzleCount) {
    throw new Error(`Corpus count mismatch: manifest=${manifest.puzzleCount}, artifact=${lines.length}.`);
  }
  const usesNativeTransactionApi = typeof db2.beginTransaction === "function" && typeof db2.commitTransaction === "function" && typeof db2.rollbackTransaction === "function";
  if (usesNativeTransactionApi) await db2.beginTransaction();
  else await db2.execute("BEGIN IMMEDIATE;");
  const transactionDb = usesNativeTransactionApi ? {
    run: (statement, values = []) => db2.run(statement, values, false),
    execute: (statements) => db2.execute(statements, false)
  } : db2;
  try {
    await transactionDb.execute("DELETE FROM puzzle_themes;");
    await transactionDb.execute("DELETE FROM puzzles;");
    for (let index = 0; index < lines.length; index += 1) {
      const record = JSON.parse(lines[index]);
      validatePuzzle(record);
      await transactionDb.run(
        "INSERT INTO puzzles (puzzle_id, fen, moves, rating, step_count) VALUES (?, ?, ?, ?, ?)",
        [record.puzzleId, record.fen, record.moves, record.rating ?? null, record.stepCount]
      );
      for (const theme of [...new Set(record.themes)]) {
        await transactionDb.run("INSERT INTO puzzle_themes (theme, puzzle_id) VALUES (?, ?)", [theme, record.puzzleId]);
      }
      if ((index + 1) % 100 === 0 || index + 1 === lines.length) {
        onProgress?.({
          phase: "import",
          loaded: index + 1,
          total: lines.length,
          percent: Math.round((index + 1) / lines.length * 100)
        });
      }
    }
    await transactionDb.run(`
      INSERT INTO corpus_meta (key, value) VALUES ('corpus_version', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `, [manifest.version]);
    await transactionDb.run(`
      INSERT INTO corpus_meta (key, value) VALUES ('corpus_sha256', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `, [manifest.sha256.toLowerCase()]);
    if (usesNativeTransactionApi) await db2.commitTransaction();
    else await db2.execute("COMMIT;");
  } catch (error) {
    try {
      if (usesNativeTransactionApi) await db2.rollbackTransaction();
      else await db2.execute("ROLLBACK;");
    } catch {
    }
    throw error;
  }
}
async function downloadAndImportCorpus({
  db: db2,
  manifest,
  fetchImpl = globalThis.fetch,
  onProgress,
  force = false
}) {
  assertDb2(db2);
  if (!manifest?.url || !manifest?.sha256 || !manifest?.version || !Number.isInteger(manifest?.puzzleCount)) {
    throw new TypeError("A complete corpus manifest is required.");
  }
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function.");
  const current = await getCorpusStatus(db2);
  if (!force && current.populated && current.version === manifest.version) {
    return { ...current, skipped: true };
  }
  const response = await fetchImpl(manifest.url);
  const compressed = await readResponseBytes(response, onProgress);
  const digest = hex(await crypto.subtle.digest("SHA-256", compressed));
  if (digest !== manifest.sha256.toLowerCase()) {
    throw new Error(`Corpus checksum mismatch: expected ${manifest.sha256.toLowerCase()}, received ${digest}.`);
  }
  onProgress?.({ phase: "verify", loaded: compressed.length, total: compressed.length, percent: 100 });
  const text = await decompressGzip(compressed);
  await importRows(db2, text, manifest, onProgress);
  return { ...await getCorpusStatus(db2), skipped: false };
}

// www/themes.js
var THEMES = Object.freeze({
  cat: Object.freeze({ label: "Orange cat", emoji: "\u{1F431}", subtitle: "Orange Tabby Edition \u{1F43E}", engine: "Orange Cat" }),
  panda: Object.freeze({ label: "Panda", emoji: "\u{1F43C}", subtitle: "Bamboo Panda Edition \u{1F38B}", engine: "Panda" }),
  "black-cat": Object.freeze({ label: "Black cat", emoji: "\u{1F408}\u200D\u2B1B", subtitle: "Midnight Cat Edition \u{1F319}", engine: "Midnight Cat" }),
  bunny: Object.freeze({ label: "Bunny", emoji: "\u{1F430}", subtitle: "Berry Bunny Edition \u{1F955}", engine: "Bunny" }),
  fox: Object.freeze({ label: "Fox", emoji: "\u{1F98A}", subtitle: "Woodland Fox Edition \u{1F342}", engine: "Fox" }),
  corgi: Object.freeze({ label: "Corgi", emoji: "\u{1F436}", subtitle: "Royal Corgi Edition \u{1F9B4}", engine: "Corgi" }),
  koala: Object.freeze({ label: "Koala", emoji: "\u{1F428}", subtitle: "Eucalyptus Koala Edition \u{1F33F}", engine: "Koala" }),
  raccoon: Object.freeze({ label: "Raccoon", emoji: "\u{1F99D}", subtitle: "Moonlit Raccoon Edition \u2728", engine: "Raccoon" }),
  otter: Object.freeze({ label: "Otter", emoji: "\u{1F9A6}", subtitle: "River Otter Edition \u{1FAE7}", engine: "Otter" }),
  "red-panda": Object.freeze({ label: "Red panda", emoji: "\u{1F43E}", subtitle: "Forest Red Panda Edition \u{1F38B}", engine: "Red Panda" })
});
function getTheme(themeId) {
  return THEMES[themeId] ?? THEMES.cat;
}
function themeOptions(selectedTheme = "cat") {
  return Object.entries(THEMES).map(
    ([value, theme]) => `<option value="${value}"${value === selectedTheme ? " selected" : ""}>${theme.emoji} ${theme.label}</option>`
  ).join("");
}
function applyAppTheme(themeId, root = document.documentElement) {
  const id = THEMES[themeId] ? themeId : "cat";
  const theme = THEMES[id];
  root.dataset.theme = id;
  document.querySelector(".brand-avatar")?.replaceChildren(theme.emoji);
  const subtitle = document.querySelector(".brand-sub");
  if (subtitle) subtitle.textContent = theme.subtitle;
  const firstRun = document.querySelector(".first-run-cat");
  if (firstRun) firstRun.textContent = theme.emoji;
  return theme;
}
var CHESSCOM_COLORS = Object.freeze({
  cat: ["#E67E22", "#D35400", "#F7EFE2", "#C8854E", "#7A4526"],
  panda: ["#2F855A", "#276749", "#F7FAF7", "#7BAE7F", "#202A24"],
  "black-cat": ["#9F7AEA", "#6B46C1", "#E9E6F2", "#4B4658", "#17151D"],
  bunny: ["#E96B9A", "#C44575", "#FFF4F7", "#DFA2B8", "#71495A"],
  fox: ["#E76F31", "#B94718", "#FFF1DF", "#C76B3D", "#66321F"],
  corgi: ["#D99024", "#9D5D12", "#FFF3D8", "#C68A43", "#5C371D"],
  koala: ["#3C8D89", "#24615E", "#F0F4F3", "#879A99", "#394544"],
  raccoon: ["#3F8C95", "#276069", "#EDF2F2", "#738386", "#30373A"],
  otter: ["#2799A3", "#17636B", "#FFF0D5", "#A26D42", "#4C3022"],
  "red-panda": ["#4F8B43", "#315E2B", "#FFF0D8", "#B95B32", "#5D2A20"]
});
function chessComCssForTheme(baseCss, themeId) {
  const colors = CHESSCOM_COLORS[themeId] ?? CHESSCOM_COLORS.cat;
  return `${baseCss}
:root {
    --chess-analyst-accent: ${colors[0]};
    --chess-analyst-accent-dark: ${colors[1]};
    --chess-analyst-board-light: ${colors[2]};
    --chess-analyst-board-dark: ${colors[3]};
    --chess-analyst-board-frame: ${colors[4]};
    --chess-analyst-highlight: color-mix(in srgb, ${colors[0]} 48%, transparent);
  }`;
}

// www/profile.js
var LABELS = Object.freeze({
  tactical: "Tactical",
  king_safety: "King safety",
  pawn_structure: "Pawn structure",
  piece_activity: "Piece activity",
  positional_judgment: "Positional judgment",
  endgame_technique: "Endgame technique",
  practical_time: "Practical / time"
});
var AVATARS = Object.freeze([
  ["orange-tabby", "\u{1F431} Orange tabby"],
  ["tuxedo", "\u{1F638} Tuxedo"],
  ["calico", "\u{1F63A} Calico"],
  ["black-cat", "\u{1F408}\u200D\u2B1B Black cat"]
]);
function engineDifficultyLabel(level) {
  const value = Number(level);
  if (value <= 4) return "Gentle kitten";
  if (value <= 9) return "Curious hunter";
  if (value <= 14) return "Sharp tabby";
  if (value <= 18) return "Fierce prowler";
  return "Grandmaster cat";
}
function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
function formatDate(value) {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? escapeHtml(value) : date.toLocaleDateString();
}
function weaknessBars(tally) {
  if (!tally.length) {
    return '<p class="empty-state">No weakness data yet \u2014 complete and analyze sessions to reveal your hunting pattern.</p>';
  }
  const counts = new Map(tally.map((item) => [item.category, Number(item.count)]));
  const max = Math.max(...counts.values(), 1);
  return `<div class="weakness-chart" role="img" aria-label="Weakness breakdown">${WEAKNESS_CATEGORIES.map((category) => {
    const count = counts.get(category) ?? 0;
    const width = Math.round(count / max * 100);
    return `<div class="weakness-row"><div class="weakness-label"><span>${LABELS[category]}</span><strong>${count}</strong></div><div class="bar-track"><span class="bar-fill category-${category}" style="width:${width}%"></span></div></div>`;
  }).join("")}</div>`;
}
function masteryCard(mastery = {}) {
  return `<div class="mastery-grid">${MASTERY_CATEGORIES.map((cat) => {
    const level = mastery[cat]?.masteryLevel ?? 0;
    const stars = "\u{1F43E}".repeat(level) + "\u26AA".repeat(5 - level);
    return `<div class="mastery-row"><span>${LABELS[cat] || cat}</span><span class="mastery-paws">${stars} (Lvl ${level}/5)</span></div>`;
  }).join("")}</div>`;
}
function streakCard(streakState = {}, todayStats = {}, dailyGoal = 3) {
  const current = streakState?.currentStreak ?? 0;
  const longest = streakState?.longestStreak ?? 0;
  const freezes = streakState?.freezesRemaining ?? 2;
  const completedToday = todayStats?.sessionsCompleted ?? 0;
  const goalTarget = Number(dailyGoal) || 3;
  const progressPercent = Math.min(100, Math.round(completedToday / goalTarget * 100));
  return `
    <div class="streak-card-body">
      <div class="streak-metrics">
        <div class="metric-item"><strong>\u{1F525} ${current}</strong><span>Current Streak</span></div>
        <div class="metric-item"><strong>\u{1F3C6} ${longest}</strong><span>Best Streak</span></div>
        <div class="metric-item"><strong>\u2744\uFE0F ${freezes}/2</strong><span>Freezes Left</span></div>
      </div>
      <div class="daily-progress-wrap">
        <div class="daily-progress-header">
          <span>Today's Hunt Goal</span>
          <strong>${completedToday} / ${goalTarget} Sessions</strong>
        </div>
        <div class="bar-track"><span class="bar-fill streak-fill" style="width:${progressPercent}%"></span></div>
      </div>
    </div>`;
}
function recentSessions(sessions) {
  if (!sessions.length) {
    return '<p class="empty-state">No sessions yet \u2014 tap Pounce on Weakness to start your first hunt.</p>';
  }
  return `<ul class="recent-list">${sessions.map((session) => `<li><div><strong>${formatDate(session.date)}</strong><span>${escapeHtml(LABELS[session.seeded_weakness] ?? session.seeded_weakness ?? "General practice")}</span></div><div class="session-result"><strong>${escapeHtml(session.result ?? "Completed")}</strong><span>${Number(session.move_count ?? 0)} moves</span></div></li>`).join("")}</ul>`;
}
function renderProfile({ container, stats, settings: settings2, corpusStatus: corpusStatus2, focus }) {
  if (!container) throw new TypeError("profile container is required.");
  const level = Number(settings2.engine_skill_level ?? 10);
  const avatarOptions = AVATARS.map(([value, label]) => `<option value="${value}"${settings2.cat_avatar === value ? " selected" : ""}>${label}</option>`).join("");
  const enoughProgress = stats.totalSessions >= 3;
  const activeTheme = getTheme(settings2.theme);
  const personaOptions = Object.values(PERSONAS).map(
    (p) => `<option value="${p.id}"${settings2.freeplay_persona === p.id ? " selected" : ""}>${p.avatar} ${p.name} (~${p.targetElo} Elo)</option>`
  ).join("");
  const timeControlOptions = STANDARD_TIME_CONTROLS.map(
    (tc) => `<option value="${tc.id}"${settings2.freeplay_time_control === tc.id ? " selected" : ""}>${tc.name}</option>`
  ).join("");
  container.innerHTML = `
    <section class="profile-hero">
      <span class="profile-avatar">${activeTheme.emoji}</span>
      <div><h2>${escapeHtml(settings2.display_name || "Your Cat Analyst Profile")}</h2><p>${stats.totalSessions ? `${stats.totalSessions} hunts completed` : "Your training story starts here."}</p></div>
    </section>

    <section class="profile-card" aria-labelledby="streak-heading">
      <h2 id="streak-heading">Daily Hunt Streak & Mastery</h2>
      ${streakCard(stats.streakState, stats.todayStats, settings2.daily_goal)}
      <h3>Category Mastery (0 - 5 Paws)</h3>
      ${masteryCard(stats.categoryMastery)}
    </section>

    <section class="profile-card" aria-labelledby="stats-heading">
      <h2 id="stats-heading">Stats</h2>
      <div class="stat-grid"><div><strong>${stats.totalSessions}</strong><span>Sessions</span></div><div><strong>${stats.totalMoves}</strong><span>Moves logged</span></div></div>
      <h3>Current focus</h3>
      <p class="focus-pill">${focus?.weaknessCategory ? escapeHtml(LABELS[focus.weaknessCategory] ?? focus.weaknessCategory) : "No focus yet"}</p>
      <h3>Weakness breakdown</h3>${weaknessBars(stats.weaknessTally)}
      <h3>Recent sessions</h3>${recentSessions(stats.recentSessions)}
      <h3>Progress over time</h3>
      ${enoughProgress ? '<p class="progress-ready">Progress tracking is unlocked. More analyzed sessions will make trends clearer.</p>' : '<p class="empty-state">Complete at least 3 sessions to unlock progress-over-time insights.</p>'}
    </section>

    <section class="profile-card" aria-labelledby="settings-heading">
      <h2 id="settings-heading">Settings & Preferences</h2>
      <form id="settings-form" class="settings-form">
        <label>Display name<input name="display_name" maxlength="40" value="${escapeHtml(settings2.display_name)}" autocomplete="name"></label>
        <label>Cat avatar<select name="cat_avatar">${avatarOptions}</select></label>
        <label>chess.com username<input name="chesscom_username" maxlength="50" value="${escapeHtml(settings2.chesscom_username)}" autocomplete="off"></label>
        <label>Daily training goal (sessions)<input name="daily_goal" type="number" min="1" max="20" value="${escapeHtml(settings2.daily_goal ?? "3")}"></label>
        <label>Freeplay default persona<select name="freeplay_persona">${personaOptions}</select></label>
        <label>Freeplay time control<select name="freeplay_time_control">${timeControlOptions}</select></label>
        <label>Engine difficulty <span id="engine-difficulty-label">${engineDifficultyLabel(level)}</span><input name="engine_skill_level" type="range" min="0" max="20" step="1" value="${level}"><output id="engine-level-output">${level}</output></label>
        <label>Animal theme<select name="theme">${themeOptions(settings2.theme)}</select></label>
        <button class="btn btn-primary" type="submit">Save settings</button>
      </form>

      <div class="corpus-status">
        <h3>Database Backup & Restore</h3>
        <p>Export all sessions and settings to JSON, or restore from a backup file.</p>
        <div class="backup-actions">
          <button id="btn-db-export" class="btn btn-secondary" type="button">\u{1F4E4} Export Database (JSON)</button>
          <button id="btn-db-import" class="btn btn-secondary" type="button">\u{1F4E5} Import Database</button>
          <input type="file" id="db-import-file" accept=".json" class="hidden">
        </div>
      </div>

      <div class="corpus-status"><h3>Puzzle corpus</h3><p>${corpusStatus2.populated ? `Version ${escapeHtml(corpusStatus2.version ?? "unknown")} \u2022 ${corpusStatus2.puzzleCount.toLocaleString()} puzzles` : "Not downloaded yet"}</p><button id="btn-corpus-update" class="btn btn-secondary" type="button">${corpusStatus2.populated ? "Re-download corpus" : "Download corpus"}</button></div>
      <div class="danger-zone"><h3>Reset all data</h3><p>Deletes your sessions, move history, weakness data, and settings. The downloaded puzzle corpus is kept.</p><button id="btn-reset-data" class="btn btn-danger" type="button">Reset all training data</button></div>
    </section>`;
}

// www/chesscom-theme.css
var chesscom_theme_default = '/**\r\n * Chess.com Mobile Visual Theme Overlay \u2014 Orange Tabby Theme Pack\r\n * THEME-ONLY: Visual styling only. No board reading, no assistance during live play.\r\n */\r\n\r\n:root {\r\n  --chess-analyst-accent: #E67E22;\r\n  --chess-analyst-accent-dark: #D35400;\r\n  --chess-analyst-board-light: #F7EFE2;\r\n  --chess-analyst-board-dark: #C8854E;\r\n  --chess-analyst-board-frame: #7A4526;\r\n  --chess-analyst-highlight: rgba(230, 126, 34, 0.45);\r\n}\r\n\r\n/* Page Background */\r\nbody, #board-layout-main, .board-layout-main {\r\n  background-color: #FAF6F0 !important;\r\n}\r\n\r\n/* Web Component Board and Squares */\r\nwc-chess-board, chess-board, .board {\r\n  background-image: conic-gradient(\r\n    var(--chess-analyst-board-dark) 25%,\r\n    var(--chess-analyst-board-light) 0 50%,\r\n    var(--chess-analyst-board-dark) 0 75%,\r\n    var(--chess-analyst-board-light) 0\r\n  ) !important;\r\n  background-size: 25% 25% !important;\r\n  background-repeat: repeat !important;\r\n  border-radius: 10px !important;\r\n  box-shadow: 0 4px 16px rgba(110, 61, 48, 0.18) !important;\r\n  border: 2px solid var(--chess-analyst-board-frame) !important;\r\n}\r\n\r\nwc-chess-board .light, chess-board .light, .board .light,\r\n.square-light, [class*="square-"][class*="light"] {\r\n  background-color: var(--chess-analyst-board-light) !important;\r\n}\r\n\r\nwc-chess-board .dark, chess-board .dark, .board .dark,\r\n.square-dark, [class*="square-"][class*="dark"] {\r\n  background-color: var(--chess-analyst-board-dark) !important;\r\n}\r\n\r\n/* Move Highlights */\r\n.highlight, [class*="highlight"], .selected-square {\r\n  background-color: var(--chess-analyst-highlight) !important;\r\n}\r\n\r\n/* Buttons & UI Accents */\r\nbutton, [role="button"], .ui_v5-button-component {\r\n  border-radius: 10px !important;\r\n}\r\n\r\n.ui_v5-button-primary {\r\n  background-color: var(--chess-analyst-accent) !important;\r\n  border-color: var(--chess-analyst-accent-dark) !important;\r\n}\r\n';

// www/chesscomView.js
var CHESSCOM_URL = "https://www.chess.com/play/online";
var THEME_STYLE_ID = "cat-analyst-theme-overlay";
function buildThemeInjectionScript(css) {
  if (typeof css !== "string" || !css.trim()) throw new TypeError("Chess.com theme CSS is required.");
  return `(() => {
    if (document.head) {
      const style = document.getElementById(${JSON.stringify(THEME_STYLE_ID)}) || document.createElement('style');
      style.id = ${JSON.stringify(THEME_STYLE_ID)};
      style.textContent = ${JSON.stringify(css)};
      if (!style.isConnected) document.head.appendChild(style);
    }
  })();`;
}
function createChessComView({ inAppBrowser, themeCss, browserOptions = {} }) {
  if (!inAppBrowser?.openWebView || !inAppBrowser?.executeScript || !inAppBrowser?.addListener) {
    throw new TypeError("A controllable embedded in-app browser is required.");
  }
  let currentThemeCss = themeCss;
  let browserId = null;
  let listenersReady = false;
  async function inject(event = {}) {
    if (!browserId || event.id && event.id !== browserId) return;
    await inAppBrowser.executeScript({ id: browserId, code: buildThemeInjectionScript(currentThemeCss) });
  }
  async function ensureListeners() {
    if (listenersReady) return;
    listenersReady = true;
    await inAppBrowser.addListener("browserPageLoaded", (event) => {
      void inject(event);
    });
    await inAppBrowser.addListener("urlChangeEvent", (event) => {
      void inject(event);
    });
    await inAppBrowser.addListener("closeEvent", (event) => {
      if (!event.id || event.id === browserId) browserId = null;
    });
  }
  return {
    get browserId() {
      return browserId;
    },
    get injectionScript() {
      return buildThemeInjectionScript(currentThemeCss);
    },
    async setThemeCss(css) {
      currentThemeCss = css;
      if (browserId) await inject({ id: browserId });
    },
    async open() {
      await ensureListeners();
      if (browserId && inAppBrowser.show) {
        await inAppBrowser.show({ id: browserId });
        await inject({ id: browserId });
        return browserId;
      }
      const result = await inAppBrowser.openWebView({
        url: CHESSCOM_URL,
        persistWebViewData: true,
        isPresentAfterPageLoad: true,
        preShowScript: buildThemeInjectionScript(currentThemeCss),
        preShowScriptInjectionTime: "pageLoad",
        ...browserOptions
      });
      browserId = result.id;
      await inject({ id: browserId });
      return browserId;
    }
  };
}

// www/app.js
var PIECES = {
  p: "\u265F",
  r: "\u265C",
  n: "\u265E",
  b: "\u265D",
  q: "\u265B",
  k: "\u265A",
  P: "\u2659",
  R: "\u2656",
  N: "\u2658",
  B: "\u2657",
  Q: "\u2655",
  K: "\u2654"
};
var ENGINE_TIMEOUT_MS = 15e3;
var DB_NAME = "chess_analyst";
var el = (id) => document.getElementById(id);
var boardEl = el("chessboard");
var moveLogEl = el("move-log");
var pvMovesEl = el("pv-moves");
var engineEvalEl = el("engine-eval");
var moveStatusEl = el("move-status");
var turnIndicatorEl = el("turn-indicator");
var systemStatusEl = el("system-status");
var targetNameEl = el("target-name");
var targetDescEl = el("target-desc");
var queueIndicatorEl = el("target-queue-indicator");
var sessionBadgeEl = el("session-badge");
var opponentAvatarEl = el("opponent-avatar");
var opponentNameEl = el("opponent-name");
var opponentClockEl = el("opponent-clock");
var userClockEl = el("user-clock");
var evalBarFillEl = el("eval-bar-fill");
var db = null;
var orchestrator = null;
var engineClient = null;
var chess = new Chess();
var activeSession = null;
var sessionClock = null;
var clockIntervalHandle = null;
var selectedSquare = null;
var boardFlipped = false;
var isEngineThinking = false;
var settings = null;
var corpusStatus = { populated: false, puzzleCount: 0, version: null };
var currentHintTier = 0;
var pendingBlunderMove = null;
var chessComView = createChessComView({
  inAppBrowser: InAppBrowser,
  themeCss: chesscom_theme_default,
  browserOptions: {
    toolbarType: ToolBarType.NAVIGATION,
    title: "Chess.com \u2022 Cat Theme",
    backgroundColor: "white",
    activeNativeNavigationForWebview: true,
    showReloadButton: true,
    closeAction: CloseAction.HIDE,
    enabledSafeTopMargin: true
  }
});
function setStatus(text) {
  if (systemStatusEl) systemStatusEl.textContent = `${text} \u2022 ${getTheme(settings?.theme).label} Theme`;
}
async function activateTheme(themeId) {
  const theme = applyAppTheme(themeId);
  await chessComView.setThemeCss(chessComCssForTheme(chesscom_theme_default, themeId));
  return theme;
}
function setMoveStatus(text) {
  if (moveStatusEl) moveStatusEl.textContent = text;
}
function setFatal(message, err) {
  console.error(message, err);
  setStatus("Startup problem");
  setMoveStatus(message);
}
function stockfishWorkerUrl() {
  return new URL("./vendor/stockfish/stockfish.js", document.baseURI).href;
}
async function initEngine() {
  const workerUrl = stockfishWorkerUrl();
  configureStockfish({ workerUrl });
  engineClient = new StockfishWorkerClient({ workerUrl });
  if (typeof engineClient.onInfo === "function") {
    engineClient.onInfo(handleInfoLine);
  } else if (engineClient.worker?.addEventListener) {
    engineClient.worker.addEventListener("message", (event) => {
      const line = typeof event.data === "string" ? event.data : event.data?.data;
      if (typeof line === "string") handleInfoLine(line);
    });
  }
  setStatus("Stockfish 18 Lite WASM active");
}
function handleInfoLine(line) {
  if (typeof line !== "string" || !line.startsWith("info ")) return;
  const cpMatch = line.match(/\bscore\s+cp\s+(-?\d+)/);
  const mateMatch = line.match(/\bscore\s+mate\s+(-?\d+)/);
  const pvMatch = line.match(/\bpv\s+(.+)$/);
  let evalCp = 0;
  let isMate = false;
  if (mateMatch) {
    isMate = true;
    evalCp = parseInt(mateMatch[1], 10) > 0 ? 1e5 : -1e5;
  } else if (cpMatch) {
    evalCp = parseInt(cpMatch[1], 10);
  }
  const evalState = computeEvalBarState({ evalCp, isMateScore: isMate });
  if (engineEvalEl) {
    engineEvalEl.textContent = `Eval: ${evalState.label}`;
  }
  if (evalBarFillEl) {
    evalBarFillEl.style.height = `${evalState.whiteHeightPercent}%`;
  }
  if (pvMatch && pvMovesEl) {
    pvMovesEl.textContent = pvMatch[1];
  }
}
function withTimeout(promise, ms) {
  let handle;
  const timeout = new Promise((resolve) => {
    handle = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(handle));
}
function startClockTimer() {
  stopClockTimer();
  if (!sessionClock) return;
  opponentClockEl?.classList.remove("hidden");
  userClockEl?.classList.remove("hidden");
  clockIntervalHandle = setInterval(() => {
    if (!sessionClock) return;
    const time = { whiteMs: sessionClock.getTime("white"), blackMs: sessionClock.getTime("black") };
    const isPlayerWhite = (activeSession?.playerColor ?? "white") === "white";
    const playerTime = isPlayerWhite ? time.whiteMs : time.blackMs;
    const oppTime = isPlayerWhite ? time.blackMs : time.whiteMs;
    if (userClockEl) {
      userClockEl.textContent = formatClockTime(playerTime);
      userClockEl.classList.toggle("low-time", playerTime <= 3e4 && playerTime > 0);
    }
    if (opponentClockEl) {
      opponentClockEl.textContent = formatClockTime(oppTime);
      opponentClockEl.classList.toggle("low-time", oppTime <= 3e4 && oppTime > 0);
    }
    const flagFallen = sessionClock.isFlagFallen("white") ? "white" : sessionClock.isFlagFallen("black") ? "black" : null;
    if (flagFallen) {
      stopClockTimer();
      const playerWon = isPlayerWhite && flagFallen === "black" || !isPlayerWhite && flagFallen === "white";
      setMoveStatus(playerWon ? "Opponent ran out of time! You win! \u{1F3C6}" : "Time ran out! Game over. \u23F1\uFE0F");
      if (activeSession) {
        activeSession.result = playerWon ? isPlayerWhite ? "1-0" : "0-1" : isPlayerWhite ? "0-1" : "1-0";
        void showScoreSummary(activeSession);
      }
    }
  }, 100);
}
function stopClockTimer() {
  if (clockIntervalHandle) {
    clearInterval(clockIntervalHandle);
    clockIntervalHandle = null;
  }
}
function squareName(fileIdx, rankIdx) {
  return `${String.fromCharCode(97 + fileIdx)}${8 - rankIdx}`;
}
function legalTargetsFrom(square) {
  try {
    return chess.moves({ square, verbose: true }).map((m) => m.to);
  } catch (err) {
    return [];
  }
}
function renderBoard() {
  if (!boardEl) return;
  boardEl.innerHTML = "";
  const board = chess.board();
  const targets = selectedSquare ? legalTargetsFrom(selectedSquare) : [];
  const inCheck = typeof chess.inCheck === "function" ? chess.inCheck() : false;
  const rankOrder = boardFlipped ? [...Array(8).keys()] : [...Array(8).keys()].reverse();
  const fileOrder = boardFlipped ? [...Array(8).keys()].reverse() : [...Array(8).keys()];
  for (const r of rankOrder) {
    for (const f of fileOrder) {
      const sq = squareName(f, r);
      const piece = board[r][f];
      const div = document.createElement("div");
      const isLight = (r + f) % 2 === 0;
      div.className = `square ${isLight ? "light" : "dark"}`;
      div.dataset.square = sq;
      if (sq === selectedSquare) div.classList.add("selected");
      if (targets.includes(sq)) {
        div.classList.add("legal-target");
        if (piece) div.classList.add("has-piece");
      }
      if (inCheck && piece && piece.type === "k" && piece.color === chess.turn()) {
        div.classList.add("in-check");
      }
      if (piece) {
        const themeId = settings?.theme ?? "cat";
        const img = document.createElement("img");
        img.src = `assets/pieces/${themeId}/${piece.color}/${piece.type}.png`;
        img.alt = `${piece.color === "w" ? "White" : "Black"} ${piece.type}`;
        img.className = `piece animal-piece ${piece.color === "w" ? "white-piece" : "black-piece"}`;
        img.draggable = false;
        img.dataset.piece = `${piece.color}${piece.type}`;
        img.addEventListener("error", () => {
          const fallback = document.createElement("span");
          fallback.textContent = piece.color === "w" ? PIECES[piece.type.toUpperCase()] : PIECES[piece.type];
          fallback.className = `piece ${piece.color === "w" ? "white-piece" : "black-piece"}`;
          fallback.dataset.piece = `${piece.color}${piece.type}`;
          img.replaceWith(fallback);
        }, { once: true });
        div.appendChild(img);
      }
      div.addEventListener("click", () => handleSquareClick(sq));
      boardEl.appendChild(div);
    }
  }
  updateTurnUI();
}
function updateTurnUI() {
  if (!turnIndicatorEl) return;
  if (chess.isGameOver?.()) {
    let reason = "Game over";
    if (chess.isCheckmate?.()) reason = "Checkmate!";
    else if (chess.isStalemate?.()) reason = "Stalemate";
    else if (chess.isDraw?.()) reason = "Draw";
    turnIndicatorEl.textContent = reason;
    return;
  }
  const isPlayerTurn = chess.turn() === (activeSession?.playerColor === "black" ? "b" : "w");
  turnIndicatorEl.textContent = isPlayerTurn ? "Your turn to pounce!" : "Stockfish is thinking\u2026";
}
function appendLog(ply, san) {
  if (!moveLogEl) return;
  const empty = moveLogEl.querySelector(".empty-log-message");
  if (empty) empty.remove();
  const div = document.createElement("div");
  div.className = "log-entry";
  div.innerHTML = `<span class="log-ply">${ply}.</span> <span class="log-move">${san}</span>`;
  moveLogEl.appendChild(div);
  moveLogEl.scrollTop = moveLogEl.scrollHeight;
}
async function handleSquareClick(square) {
  if (!activeSession) {
    setMoveStatus('Start a session first \u2014 tap "Pounce on Weakness" or "Free Play".');
    return;
  }
  if (isEngineThinking) return;
  if (chess.isGameOver?.()) return;
  const isPlayerTurn = chess.turn() === (activeSession.playerColor === "black" ? "b" : "w");
  if (!isPlayerTurn) return;
  const piece = chess.get(square);
  if (selectedSquare) {
    if (legalTargetsFrom(selectedSquare).includes(square)) {
      await initiatePlayerMove(selectedSquare, square);
      return;
    }
    selectedSquare = piece && piece.color === chess.turn() ? square : null;
    renderBoard();
    return;
  }
  if (piece && piece.color === chess.turn()) {
    selectedSquare = square;
    setMoveStatus(`Target selected: ${square}`);
    renderBoard();
  }
}
async function initiatePlayerMove(from, to) {
  const uci = from + to;
  const fenBefore = chess.fen();
  if (engineClient) {
    try {
      const blunderCheck = await checkBlunderCandidate(fenBefore, uci, engineClient);
      if (blunderCheck?.isBlunder) {
        pendingBlunderMove = { from, to, uci };
        const warningEl = el("blunder-warning-text");
        if (warningEl && blunderCheck.message) {
          warningEl.textContent = blunderCheck.message;
        }
        el("blunder-modal")?.classList.remove("hidden");
        selectedSquare = null;
        renderBoard();
        return;
      }
    } catch (err) {
      console.warn("Blunder check non-fatal error:", err);
    }
  }
  await executePlayerMove(from, to);
}
async function executePlayerMove(from, to) {
  let move = null;
  try {
    move = chess.move({ from, to, promotion: "q" });
  } catch {
    move = null;
  }
  if (!move) {
    setMoveStatus("That move is not legal.");
    selectedSquare = null;
    renderBoard();
    return;
  }
  selectedSquare = null;
  appendLog(Math.ceil(chess.history().length / 2), move.san);
  renderBoard();
  if (sessionClock) {
    if (!sessionClock.isRunning) sessionClock.start(chess.turn() === "b" ? "black" : "white");
    else sessionClock.switchTurn();
  }
  const uci = move.from + move.to + (move.promotion ?? "");
  isEngineThinking = true;
  setMoveStatus(`${activeSession.persona ? resolvePersona(activeSession.persona).name : "Stockfish"} is calculating\u2026`);
  updateTurnUI();
  let result = null;
  try {
    result = await withTimeout(activeSession.playTurn(uci), ENGINE_TIMEOUT_MS);
  } catch (err) {
    console.error("playTurn failed", err);
    setMoveStatus("Engine hiccup \u2014 your move stands, try again.");
  } finally {
    isEngineThinking = false;
  }
  if (!result) {
    setMoveStatus("Engine did not reply in time. Tap a piece to try again.");
    renderBoard();
    return;
  }
  const engineMove = result.engineLog?.move_played;
  if (engineMove) {
    try {
      const applied = chess.move({
        from: engineMove.slice(0, 2),
        to: engineMove.slice(2, 4),
        promotion: engineMove.length > 4 ? engineMove[4] : void 0
      });
      if (applied) appendLog(Math.ceil(chess.history().length / 2), applied.san);
    } catch (err) {
      console.error("Could not apply engine move locally", err);
    }
  }
  if (sessionClock && sessionClock.isRunning) {
    sessionClock.switchTurn();
  }
  if (result.currentFen && chess.fen() !== result.currentFen) {
    chess = new Chess(result.currentFen);
  }
  if (chess.isGameOver?.()) {
    stopClockTimer();
    let res = "1/2-1/2";
    if (chess.isCheckmate?.()) {
      res = chess.turn() === "w" ? "0-1" : "1-0";
    }
    activeSession.result = res;
    setMoveStatus("Game over! Complete session to view your score.");
    void showScoreSummary(activeSession);
  } else {
    setMoveStatus("Your move.");
  }
  renderBoard();
}
async function openHintModal() {
  if (!activeSession) {
    setMoveStatus("Start a session first to request hints.");
    return;
  }
  currentHintTier = 1;
  el("hint-tier-2")?.classList.add("hidden");
  el("hint-tier-3")?.classList.add("hidden");
  const moreBtn = el("btn-hint-more");
  if (moreBtn) {
    moreBtn.disabled = false;
    moreBtn.textContent = "\u{1F43E} Need More Help?";
  }
  const t1El = el("hint-text-1");
  if (t1El) t1El.textContent = "Calculating board awareness\u2026";
  el("hint-modal")?.classList.remove("hidden");
  try {
    const hint1 = await generateHint(chess.fen(), "warm", engineClient);
    if (t1El) t1El.textContent = hint1.message;
    activeSession.recordHint("warm", hint1.type);
  } catch (err) {
    if (t1El) t1El.textContent = "Look for undefended pieces and active squares.";
  }
}
async function requestNextHintTier() {
  if (!activeSession) return;
  if (currentHintTier === 1) {
    currentHintTier = 2;
    el("hint-tier-2")?.classList.remove("hidden");
    const t2El = el("hint-text-2");
    if (t2El) t2El.textContent = "Searching opponent threats\u2026";
    try {
      const hint2 = await generateHint(chess.fen(), "warmer", engineClient);
      if (t2El) t2El.textContent = hint2.message;
      activeSession.recordHint("warmer", hint2.type);
    } catch {
      if (t2El) t2El.textContent = "Watch out for opponent tactical counters.";
    }
  } else if (currentHintTier === 2) {
    currentHintTier = 3;
    el("hint-tier-3")?.classList.remove("hidden");
    const t3El = el("hint-text-3");
    if (t3El) t3El.textContent = "Finding best piece to move\u2026";
    const moreBtn = el("btn-hint-more");
    if (moreBtn) {
      moreBtn.disabled = true;
      moreBtn.textContent = "Max Hint Reached";
    }
    try {
      const hint3 = await generateHint(chess.fen(), "hot", engineClient);
      if (t3El) t3El.textContent = hint3.message;
      activeSession.recordHint("hot", hint3.type);
    } catch {
      if (t3El) t3El.textContent = "Look for the most forcing move.";
    }
  }
}
function handleTakeback() {
  if (!activeSession || activeSession.logs.length === 0) {
    setMoveStatus("No moves to take back.");
    return;
  }
  const tb = activeSession.takeback();
  chess = new Chess(tb.revertedFen);
  selectedSquare = null;
  renderBoard();
  if (moveLogEl) {
    moveLogEl.innerHTML = '<div class="empty-log-message">Move taken back. Try another line! \u{1F43E}</div>';
    for (const log of activeSession.logs) {
      appendLog(log.ply_number, log.move_played);
    }
  }
  setMoveStatus(`Takeback applied (${tb.takebackCount} total). Assistance level: ${activeSession.computeAssistanceLevel()}.`);
}
async function handleOfferDraw() {
  if (!activeSession) return;
  setMoveStatus("Offering draw to Stockfish\u2026");
  const offer = await activeSession.offerDraw();
  if (offer.accepted) {
    stopClockTimer();
    setMoveStatus("Draw agreed! (Evaluation is within +/- 0.75 pawns). \u{1F91D}");
    void showScoreSummary(activeSession);
  } else {
    setMoveStatus("Draw declined. Stockfish wants to play on! \u2694\uFE0F");
  }
}
function handleResign() {
  if (!activeSession) return;
  if (!window.confirm("Resign the game?")) return;
  stopClockTimer();
  activeSession.resign();
  setMoveStatus("You resigned. Game over.");
  void showScoreSummary(activeSession);
}
async function showScoreSummary(session) {
  const summary = session.summary();
  const score = calculateSeedScore(summary);
  const gradeEl = el("score-grade");
  const totalEl = el("score-total");
  const accEl = el("score-accuracy");
  const motifEl = el("score-motif");
  const hintsEl = el("score-hints");
  const assistEl = el("score-assistance");
  if (gradeEl) gradeEl.textContent = score.grade;
  if (totalEl) totalEl.textContent = score.totalScore;
  if (accEl) accEl.textContent = score.accuracyComponent.toFixed(1);
  if (motifEl) motifEl.textContent = score.motifComponent.toFixed(1);
  if (hintsEl) hintsEl.textContent = `-${score.hintPenalty.toFixed(1)}`;
  if (assistEl) assistEl.textContent = summary.assistance_level.toUpperCase();
  el("score-modal")?.classList.remove("hidden");
  try {
    await saveSeedScore(db, {
      gameId: session.gameId,
      accuracyComponent: score.accuracyComponent,
      motifComponent: score.motifComponent,
      hintPenalty: score.hintPenalty,
      totalScore: score.totalScore,
      letterGrade: score.grade,
      assistanceLevel: summary.assistance_level
    });
    await recordDailySession(db, session.gameId);
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const todayStats = await getDailyStats(db, today);
    const streakState = await getStreakState(db);
    const updatedStreak = processDailyStreakUpdate({
      streakState,
      currentDate: today,
      sessionsCompletedToday: todayStats?.sessionsCompleted ?? 1,
      goalTarget: Number(settings?.daily_goal) || 3
    });
    await updateStreakState(db, updatedStreak);
    if (session.seededWeakness) {
      const currentMastery = await getCategoryMastery(db);
      const curLvl = currentMastery[session.seededWeakness]?.masteryLevel ?? 0;
      const nextLvl = advanceCategoryMastery(curLvl, score.totalScore);
      await updateCategoryMastery(db, {
        category: session.seededWeakness,
        masteryLevel: nextLvl,
        lastPracticedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
  } catch (err) {
    console.warn("Could not record score/streak in SQLite:", err);
  }
}
function syncSessionToBoard(session) {
  activeSession = session;
  const fen = session?.currentFen ?? session?.startFen;
  chess = fen ? new Chess(fen) : new Chess();
  boardFlipped = (session?.playerColor ?? "white") === "black";
  selectedSquare = null;
  if (session?.timeControl && session.timeControl !== "none") {
    sessionClock = new ChessClock({ timeControl: session.timeControl });
    startClockTimer();
  } else {
    sessionClock = null;
    stopClockTimer();
    opponentClockEl?.classList.add("hidden");
    userClockEl?.classList.add("hidden");
  }
  const personaObj = resolvePersona(session?.persona);
  if (opponentAvatarEl) opponentAvatarEl.textContent = personaObj.avatar;
  if (opponentNameEl) opponentNameEl.textContent = `${personaObj.name} (~${personaObj.targetElo} Elo)`;
  if (moveLogEl) {
    moveLogEl.innerHTML = '<div class="empty-log-message">Position loaded. Your move! \u{1F43E}</div>';
  }
  renderBoard();
}
async function startTargetedSession() {
  try {
    setMoveStatus("Finding your weakest spot\u2026");
    const focus = await orchestrator.startTargetedSession();
    if (!focus.weaknessCategory || !focus.activeSession) {
      setMoveStatus(focus.advice ?? "No seedable weakness yet \u2014 play a few games first.");
      return;
    }
    if (targetNameEl) targetNameEl.textContent = `${focus.weaknessCategory.replace(/_/g, " ")} motifs`;
    if (targetDescEl) targetDescEl.textContent = `Start-slow: ${focus.queued.length} seed puzzles queued`;
    if (queueIndicatorEl) queueIndicatorEl.textContent = `Seed 1 of ${focus.queued.length}`;
    if (sessionBadgeEl) sessionBadgeEl.textContent = "Practice Mode";
    syncSessionToBoard(focus.activeSession);
    setMoveStatus("Targeted hunt started. Pounce!");
  } catch (err) {
    setFatal("Could not start a session.", err);
  }
}
async function startFreeplaySession() {
  try {
    const persona = settings?.freeplay_persona || "tabby";
    const timeControl = settings?.freeplay_time_control || "3|2";
    const playerColor = "white";
    const session = new PracticeSession({
      mode: "freeplay",
      persona,
      timeControl,
      playerColor,
      engine: engineClient,
      gameId: `freeplay-${Date.now()}`
    });
    if (targetNameEl) targetNameEl.textContent = "Free Play vs Stockfish";
    if (targetDescEl) targetDescEl.textContent = `Persona: ${resolvePersona(persona).name} \u2022 Clock: ${timeControl}`;
    if (queueIndicatorEl) queueIndicatorEl.textContent = "Unseeded";
    if (sessionBadgeEl) sessionBadgeEl.textContent = "Free Play \u2694\uFE0F";
    syncSessionToBoard(session);
    setMoveStatus("Free play game started! Make your move.");
  } catch (err) {
    setFatal("Could not start free play session.", err);
  }
}
async function startNextQueued() {
  try {
    const next = await orchestrator.startNextQueuedSession();
    if (!next) {
      setMoveStatus("No more seeds queued \u2014 start a new hunt.");
      return;
    }
    if (queueIndicatorEl) queueIndicatorEl.textContent = "Seed 2 of 2";
    syncSessionToBoard(next);
    setMoveStatus("Second seed loaded.");
  } catch (err) {
    setFatal("Could not load the next seed.", err);
  }
}
async function completeSession() {
  if (!activeSession) {
    setMoveStatus("No active session to save.");
    return;
  }
  if (!window.confirm("End this session and save it?")) return;
  stopClockTimer();
  try {
    await orchestrator.completeSession(activeSession);
    await showScoreSummary(activeSession);
    activeSession = null;
    setMoveStatus("Session saved to your history.");
    if (sessionBadgeEl) sessionBadgeEl.textContent = "Saved";
    const focus = await orchestrator.getNextFocus();
    if (targetNameEl && focus?.weaknessCategory) {
      targetNameEl.textContent = `${focus.weaknessCategory.replace(/_/g, " ")} motifs`;
      if (targetDescEl) targetDescEl.textContent = "Next focus ready";
    }
  } catch (err) {
    setFatal("Could not save the session.", err);
  }
}
function showPage(page) {
  const profile = page === "profile";
  el("practice-page")?.classList.toggle("hidden", profile);
  el("profile-page")?.classList.toggle("hidden", !profile);
  el("nav-practice")?.classList.toggle("active", !profile);
  el("nav-profile")?.classList.toggle("active", profile);
  if (profile) void refreshProfile();
}
async function openChessCom() {
  setStatus("Opening themed Chess.com");
  try {
    await chessComView.open();
    setStatus("Chess.com theme active");
  } catch (error) {
    console.error("Could not open embedded Chess.com", error);
    setStatus("Chess.com could not open");
    setMoveStatus("Embedded Chess.com failed to open. Check the connection and try again.");
  }
}
function setCorpusProgress({ phase, percent }) {
  const progress = el("corpus-progress");
  const label = el("corpus-progress-label");
  progress?.classList.remove("hidden");
  if (progress && Number.isFinite(percent)) progress.value = percent;
  if (label) {
    const action = phase === "import" ? "Importing puzzles" : phase === "verify" ? "Verifying download" : "Downloading puzzle pack";
    label.textContent = Number.isFinite(percent) ? `${action}\u2026 ${percent}%` : `${action}\u2026`;
  }
}
async function importCorpus({ force = false } = {}) {
  const button = el("btn-download-corpus");
  if (!CORPUS_MANIFEST.url || !CORPUS_MANIFEST.sha256) {
    throw new Error("The M9 corpus release asset has not been published yet.");
  }
  if (button) button.disabled = true;
  try {
    corpusStatus = await downloadAndImportCorpus({
      db,
      manifest: CORPUS_MANIFEST,
      force,
      onProgress: setCorpusProgress
    });
    el("corpus-first-run")?.classList.add("hidden");
    if (el("corpus-progress-label")) el("corpus-progress-label").textContent = `${corpusStatus.puzzleCount.toLocaleString()} puzzles ready.`;
    if (!orchestrator) await initializePractice();
    await refreshProfile();
    setStatus("Ready");
  } catch (error) {
    console.error("Corpus import failed", error);
    if (el("corpus-progress-label")) el("corpus-progress-label").textContent = `${error.message} Check your connection and try again.`;
    throw error;
  } finally {
    if (button) button.disabled = false;
  }
}
async function refreshProfile() {
  if (!db) return;
  settings = await getSettings(db);
  await activateTheme(settings.theme);
  const stats = await getProfileStats(db);
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  stats.todayStats = await getDailyStats(db, today);
  stats.streakState = await getStreakState(db);
  stats.categoryMastery = await getCategoryMastery(db);
  corpusStatus = await getCorpusStatus(db);
  let focus = null;
  if (orchestrator && corpusStatus.populated) {
    try {
      focus = await orchestrator.getNextFocus();
    } catch (error) {
      console.warn("Could not resolve profile focus", error);
    }
  }
  const container = el("profile-page");
  renderProfile({ container, stats, settings, corpusStatus, focus });
  const range = container.querySelector('[name="engine_skill_level"]');
  range?.addEventListener("input", () => {
    const output = el("engine-level-output");
    const label = el("engine-difficulty-label");
    if (output) output.textContent = range.value;
    if (label) label.textContent = engineDifficultyLabel(range.value);
  });
  el("settings-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    for (const key of ["display_name", "cat_avatar", "chesscom_username", "engine_skill_level", "theme", "daily_goal", "freeplay_persona", "freeplay_time_control"]) {
      await setSetting(db, key, form.get(key));
    }
    settings = await getSettings(db);
    await activateTheme(settings.theme);
    orchestrator?.setSkillLevel(Number(settings.engine_skill_level));
    const display = el("engine-skill-display");
    if (display) display.textContent = `Engine Skill: ${settings.engine_skill_level}`;
    setStatus("Settings saved");
    await refreshProfile();
  });
  el("btn-db-export")?.addEventListener("click", async () => {
    try {
      const data = await exportDatabaseJson(db);
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cat_analyst_backup_${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus("Database exported");
    } catch (err) {
      alert("Export failed: " + err.message);
    }
  });
  el("btn-db-import")?.addEventListener("click", () => {
    el("db-import-file")?.click();
  });
  el("db-import-file")?.addEventListener("change", async (e) => {
    const file2 = e.target.files?.[0];
    if (!file2) return;
    try {
      const text = await file2.text();
      const payload = JSON.parse(text);
      await importDatabaseJson(db, payload);
      alert("Database restored successfully!");
      await refreshProfile();
    } catch (err) {
      alert("Import failed: " + err.message);
    }
  });
  el("btn-corpus-update")?.addEventListener("click", () => importCorpus({ force: true }).catch(() => {
  }));
  el("btn-reset-data")?.addEventListener("click", async () => {
    if (!window.confirm("Delete all sessions, move history, weakness data, and settings? This cannot be undone.")) return;
    await resetUserData(db);
    activeSession = null;
    setStatus("Training data reset");
    await refreshProfile();
  });
}
async function initializePractice() {
  const puzzleLibrary = new MobileSqlitePuzzleLibrary(db);
  await initEngine();
  settings = await getSettings(db);
  orchestrator = new TrainingOrchestrator({
    db,
    storage: mobileDb_exports,
    puzzleLibrary,
    engineFactory: () => engineClient,
    skillLevel: Number(settings.engine_skill_level)
  });
  const display = el("engine-skill-display");
  if (display) display.textContent = `Engine Skill: ${settings.engine_skill_level}`;
  chess = new Chess();
  renderBoard();
  setStatus("Ready");
  setMoveStatus('Tap "Pounce on Weakness" or "Free Play" to begin.');
}
async function boot() {
  setStatus("Waking the cat\u2026");
  try {
    db = await initDb(DB_NAME);
  } catch (err) {
    setFatal("Could not open local storage. Sessions will not be saved.", err);
    return;
  }
  try {
    corpusStatus = await getCorpusStatus(db);
    settings = await getSettings(db);
  } catch (err) {
    setFatal("Could not inspect local app data.", err);
    return;
  }
  if (corpusStatus.populated) {
    try {
      await initializePractice();
    } catch (err) {
      setFatal("Stockfish or the puzzle library failed to start.", err);
      return;
    }
  } else {
    chess = new Chess();
    renderBoard();
    el("corpus-first-run")?.classList.remove("hidden");
    setStatus("Puzzle pack needed");
    setMoveStatus("Download the one-time puzzle pack to begin.");
  }
  el("btn-start-target")?.addEventListener("click", startTargetedSession);
  el("btn-freeplay")?.addEventListener("click", startFreeplaySession);
  el("btn-next-queued")?.addEventListener("click", startNextQueued);
  el("btn-complete")?.addEventListener("click", completeSession);
  el("btn-download-corpus")?.addEventListener("click", () => importCorpus().catch(() => {
  }));
  el("nav-practice")?.addEventListener("click", () => showPage("practice"));
  el("nav-profile")?.addEventListener("click", () => showPage("profile"));
  el("nav-chesscom")?.addEventListener("click", () => {
    void openChessCom();
  });
  el("btn-flip")?.addEventListener("click", () => {
    boardFlipped = !boardFlipped;
    renderBoard();
  });
  el("btn-hint")?.addEventListener("click", openHintModal);
  el("btn-hint-more")?.addEventListener("click", requestNextHintTier);
  el("btn-hint-close")?.addEventListener("click", () => el("hint-modal")?.classList.add("hidden"));
  el("btn-takeback")?.addEventListener("click", handleTakeback);
  el("btn-draw")?.addEventListener("click", handleOfferDraw);
  el("btn-resign")?.addEventListener("click", handleResign);
  el("btn-blunder-cancel")?.addEventListener("click", () => {
    pendingBlunderMove = null;
    el("blunder-modal")?.classList.add("hidden");
    setMoveStatus("Move cancelled. Choose a better line!");
  });
  el("btn-blunder-confirm")?.addEventListener("click", async () => {
    el("blunder-modal")?.classList.add("hidden");
    if (pendingBlunderMove) {
      const { from, to } = pendingBlunderMove;
      pendingBlunderMove = null;
      await executePlayerMove(from, to);
    }
  });
  el("btn-score-continue")?.addEventListener("click", () => {
    el("score-modal")?.classList.add("hidden");
  });
  el("tab-moves")?.addEventListener("click", () => {
    el("tab-content-moves")?.classList.remove("hidden");
    el("tab-content-preview")?.classList.add("hidden");
    el("tab-moves")?.classList.add("active");
    el("tab-preview")?.classList.remove("active");
  });
  el("tab-preview")?.addEventListener("click", () => {
    el("tab-content-preview")?.classList.remove("hidden");
    el("tab-content-moves")?.classList.add("hidden");
    el("tab-preview")?.classList.add("active");
    el("tab-moves")?.classList.remove("active");
  });
  await refreshProfile();
}
document.addEventListener("DOMContentLoaded", boot);
/*! Bundled license information:

@capacitor/core/dist/index.js:
  (*! Capacitor: https://capacitorjs.com/ - MIT License *)

chess.js/dist/esm/chess.js:
  (**
   * @license
   * Copyright (c) 2025, Jeff Hlywa (jhlywa@gmail.com)
   * All rights reserved.
   *
   * Redistribution and use in source and binary forms, with or without
   * modification, are permitted provided that the following conditions are met:
   *
   * 1. Redistributions of source code must retain the above copyright notice,
   *    this list of conditions and the following disclaimer.
   * 2. Redistributions in binary form must reproduce the above copyright notice,
   *    this list of conditions and the following disclaimer in the documentation
   *    and/or other materials provided with the distribution.
   *
   * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
   * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
   * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
   * ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
   * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
   * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
   * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
   * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
   * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
   * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
   * POSSIBILITY OF SUCH DAMAGE.
   *)
*/
//# sourceMappingURL=bundle.js.map
