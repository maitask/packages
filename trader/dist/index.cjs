var TraderPackage = (() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // trader/index.js
  var index_exports = {};
  __export(index_exports, {
    execute: () => execute
  });

  // trader/shared/constants.js
  var BINANCE_FUTURES_URL = "https://fapi.binance.com";
  var BINANCE_FUTURES_TESTNET_URL = "https://testnet.binancefuture.com";
  var BINANCE_SPOT_URL = "https://api.binance.com";
  var BINANCE_SPOT_TESTNET_URL = "https://testnet.binance.vision";
  var ASTER_FUTURES_URL = "https://fapi.asterdex.com";
  var OKX_BASE_URL = "https://www.okx.com";

  // trader/shared/utils.js
  function mergeObjects(base = {}, extra = {}) {
    return { ...base || {}, ...extra || {} };
  }
  function toNumber(value) {
    if (value === void 0 || value === null || value === "") return void 0;
    const num = Number(value);
    return Number.isFinite(num) ? num : void 0;
  }
  function sanitizePrecision(value, precision = 4) {
    if (!Number.isFinite(value) || value <= 0) return null;
    const factor = Math.pow(10, precision);
    return Math.round(value * factor) / factor;
  }
  function normalizeParams(params = {}) {
    const result = {};
    Object.entries(params).forEach(([key, value]) => {
      if (value === void 0 || value === null) {
        return;
      }
      result[key] = Array.isArray(value) ? value.join(",") : value;
    });
    return result;
  }
  async function handleJSON(response) {
    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch (err) {
      throw new Error(`Invalid JSON response: ${err.message}`);
    }
    if (!response.ok) {
      const msg = data?.msg || data?.message || response.statusText;
      throw new Error(`HTTP ${response.status}: ${msg}`);
    }
    return data;
  }
  function ensureFetch(requiredBy = "@maitask/trader") {
    if (typeof fetch !== "function") {
      throw new Error(`Global fetch API is required. Please run ${requiredBy} on Node.js 18+/Deno.`);
    }
  }
  function ensureCrypto() {
    if (!globalThis.crypto && typeof __require !== "function") {
      throw new Error("Crypto module is required for signing requests.");
    }
  }
  async function signPayload(secret, payload) {
    if (globalThis.crypto?.subtle) {
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
      return bufferToHex(signature);
    }
    const { createHmac } = await import("node:crypto");
    return createHmac("sha256", secret).update(payload).digest("hex");
  }
  function bufferToHex(buffer) {
    return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // trader/shared/websocket.js
  var WebSocketImpl = typeof WebSocket !== "undefined" ? WebSocket : null;
  async function loadWebSocketClass() {
    if (WebSocketImpl) {
      return WebSocketImpl;
    }
    try {
      const wsModule = await import("ws");
      WebSocketImpl = wsModule?.WebSocket || wsModule?.default || wsModule;
      if (!WebSocketImpl) {
        throw new Error("Module ws did not export WebSocket constructor");
      }
      return WebSocketImpl;
    } catch (err) {
      throw new Error(`WebSocket API unavailable in this runtime: ${err.message}`);
    }
  }
  function normalizeMessageData(data) {
    if (typeof data === "string") {
      return data;
    }
    if (data instanceof ArrayBuffer) {
      return new TextDecoder().decode(data);
    }
    if (ArrayBuffer.isView(data)) {
      return new TextDecoder().decode(data);
    }
    if (typeof data === "object" && data !== null && data.data) {
      return normalizeMessageData(data.data);
    }
    return data;
  }
  async function collectWebSocketFeed({
    url,
    protocols,
    message_limit = 20,
    duration_ms = 5e3,
    onOpen,
    transform,
    shouldInclude
  }) {
    const WS = await loadWebSocketClass();
    const messages = [];
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        if (settled) return;
        settled = true;
        try {
          ws.close();
        } catch {
        }
        clearTimeout(timeout);
      };
      const resolveWith = (value) => {
        cleanup();
        resolve(value);
      };
      const rejectWith = (error) => {
        cleanup();
        reject(error);
      };
      const ws = new WS(url, protocols);
      const attach = (event, handler) => {
        if (typeof ws.addEventListener === "function") {
          ws.addEventListener(event, handler);
        } else if (typeof ws.on === "function") {
          ws.on(event, handler);
        } else {
          ws[`on${event}`] = handler;
        }
      };
      const timeout = setTimeout(() => {
        resolveWith(messages);
      }, duration_ms);
      attach("open", () => {
        if (typeof onOpen === "function") {
          try {
            onOpen(ws);
          } catch (err) {
            rejectWith(err);
          }
        }
      });
      attach("error", (event) => {
        rejectWith(new Error(`WebSocket error: ${event?.message || "unknown"}`));
      });
      attach("message", (event) => {
        try {
          const raw = normalizeMessageData(event?.data ?? event);
          const transformed = typeof transform === "function" ? transform(raw) : raw;
          if (shouldInclude && !shouldInclude(transformed)) {
            return;
          }
          messages.push(transformed);
          if (messages.length >= message_limit) {
            resolveWith(messages);
          }
        } catch (err) {
          rejectWith(err);
        }
      });
      attach("close", () => {
        resolveWith(messages);
      });
    });
  }

  // trader/shared/streaming.js
  var BINANCE_FUTURES_WS = "wss://fstream.binance.com/ws";
  var BINANCE_SPOT_WS = "wss://stream.binance.com:9443/ws";
  var ASTER_FUTURES_WS = "wss://fstream.asterdex.com/ws";
  var OKX_PUBLIC_WS = "wss://ws.okx.com:8443/ws/v5/public";
  function buildBinanceStreamName(symbol, channel, interval = "1m") {
    const lowerSymbol = symbol.toLowerCase();
    switch (channel) {
      case "ticker":
        return `${lowerSymbol}@ticker`;
      case "trade":
        return `${lowerSymbol}@trade`;
      case "kline":
        return `${lowerSymbol}@kline_${interval}`;
      case "miniTicker":
        return `${lowerSymbol}@miniTicker`;
      case "bookTicker":
      default:
        return `${lowerSymbol}@bookTicker`;
    }
  }
  async function streamBinanceFeed({
    symbol,
    channel = "bookTicker",
    interval = "1m",
    limit = 20,
    duration_ms = 5e3,
    market = "futures",
    endpointOverride
  }) {
    const baseWs = endpointOverride || (market === "spot" ? BINANCE_SPOT_WS : market === "aster" ? ASTER_FUTURES_WS : BINANCE_FUTURES_WS);
    const streamName = buildBinanceStreamName(symbol, channel, interval);
    const url = `${baseWs}/${streamName}`;
    const samples = await collectWebSocketFeed({
      url,
      message_limit: limit,
      duration_ms,
      transform: (raw) => {
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        return {
          eventTime: Number(parsed.E || parsed.eventTime || Date.now()),
          updateId: parsed.u || parsed.U || parsed.updateId || null,
          price: Number(parsed.c || parsed.p || parsed.P || parsed.price || 0),
          bestBid: Number(parsed.b || parsed.bestBidPrice || 0),
          bestAsk: Number(parsed.a || parsed.bestAskPrice || 0),
          volume: Number(parsed.v || parsed.volume || 0),
          raw: parsed
        };
      }
    });
    return {
      provider: market === "aster" ? "aster" : "binance",
      channel,
      symbol,
      samples,
      stats: {
        count: samples.length,
        duration_ms
      }
    };
  }
  async function streamOkxFeed({
    symbol,
    channel = "tickers",
    limit = 20,
    duration_ms = 5e3,
    market = "swap"
  }) {
    const upper = symbol.toUpperCase();
    const quotes = ["USDT", "USDC", "BTC", "ETH"];
    const quote = quotes.find((q) => upper.endsWith(q)) || "USDT";
    const base = upper.slice(0, upper.length - quote.length) || upper;
    const pair = `${base}-${quote}`;
    const instId = market === "spot" ? pair : `${pair}-SWAP`;
    const args = [
      {
        channel,
        instId
      }
    ];
    const samples = await collectWebSocketFeed({
      url: OKX_PUBLIC_WS,
      message_limit: limit,
      duration_ms,
      onOpen: (ws) => {
        ws.send(
          JSON.stringify({
            op: "subscribe",
            args
          })
        );
      },
      transform: (raw) => {
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        return parsed;
      },
      shouldInclude: (message) => Array.isArray(message?.data) && message.data.length > 0
    });
    const flattened = samples.map((item) => item.data || []).flat().map((data) => ({
      ts: Number(data.ts || Date.now()),
      price: Number(data.last || data.lastPx || 0),
      bestBid: Number(data.bidPx || 0),
      bestAsk: Number(data.askPx || 0),
      volume24h: Number(data.vol24h || 0),
      raw: data
    }));
    return {
      provider: "okx",
      channel,
      symbol,
      samples: flattened,
      stats: {
        count: flattened.length,
        duration_ms
      }
    };
  }

  // trader/providers/binance.js
  function createPrivateRequest(baseUrl, config) {
    if (!config.apiKey || !config.apiSecret) {
      return null;
    }
    return async function request(method, path, params = {}) {
      const timestamp = Date.now();
      const query = new URLSearchParams({
        ...normalizeParams(params),
        timestamp,
        recvWindow: params.recvWindow || config.recvWindow || 5e3
      }).toString();
      const signature = await signPayload(config.apiSecret, query);
      const url = `${baseUrl}${path}?${query}&signature=${signature}`;
      const response = await fetch(url, {
        method,
        headers: {
          "X-MBX-APIKEY": config.apiKey
        }
      });
      return handleJSON(response);
    };
  }
  function publicFetcher(baseUrl) {
    return async function get(path, params = {}) {
      const qs = new URLSearchParams(normalizeParams(params)).toString();
      const url = qs ? `${baseUrl}${path}?${qs}` : `${baseUrl}${path}`;
      const response = await fetch(url);
      return handleJSON(response);
    };
  }
  function createFuturesClient(config) {
    const baseUrl = config.testnet ? BINANCE_FUTURES_TESTNET_URL : BINANCE_FUTURES_URL;
    const privateRequest = createPrivateRequest(baseUrl, config);
    const publicGet = publicFetcher(baseUrl);
    return {
      mode: "binance-futures",
      async getMarketSnapshot(symbol, interval, limit) {
        const [candles, ticker, funding] = await Promise.all([
          publicGet("/fapi/v1/klines", { symbol, interval, limit }),
          publicGet("/fapi/v2/ticker/price", { symbol }),
          publicGet("/fapi/v1/premiumIndex", { symbol }).catch(() => ({}))
        ]);
        return {
          symbol,
          price: Number(ticker.price),
          fundingRate: funding?.lastFundingRate ? Number(funding.lastFundingRate) : null,
          markPrice: funding?.markPrice ? Number(funding.markPrice) : Number(ticker.price),
          candles
        };
      },
      async getHistoricalCandles(symbol, interval, limit) {
        return publicGet("/fapi/v1/klines", { symbol, interval, limit });
      },
      async placeOrder(payload) {
        if (!privateRequest) {
          throw new Error("Binance futures credentials not provided");
        }
        const params = {
          symbol: payload.symbol,
          side: payload.side,
          type: payload.type,
          quantity: sanitizePrecision(payload.quantity, payload.quantityPrecision) || payload.quantity,
          reduceOnly: payload.reduceOnly,
          positionSide: payload.positionSide,
          timeInForce: payload.timeInForce
        };
        if (payload.type === "LIMIT" && payload.price) {
          params.price = payload.price;
        }
        return privateRequest("POST", "/fapi/v1/order", params);
      },
      async getAccountSnapshot(symbol) {
        if (!privateRequest) {
          throw new Error("Binance futures credentials not provided");
        }
        const account = await privateRequest("GET", "/fapi/v2/account");
        const position = account.positions?.find((p) => p.symbol === symbol) || null;
        return {
          balance: Number(account.totalWalletBalance),
          equity: Number(account.totalMarginBalance),
          positions: account.positions || [],
          selectedPosition: position
        };
      },
      async cancelOrder(params) {
        if (!privateRequest) {
          throw new Error("Binance futures credentials not provided");
        }
        return privateRequest("DELETE", "/fapi/v1/order", params);
      },
      async streamMarket(symbol, options = {}) {
        return streamBinanceFeed({
          symbol,
          channel: options.channel,
          interval: options.interval,
          limit: options.limit,
          duration_ms: options.duration_ms,
          market: "futures"
        });
      }
    };
  }
  function createSpotClient(config) {
    const baseUrl = config.testnet ? BINANCE_SPOT_TESTNET_URL : BINANCE_SPOT_URL;
    const privateRequest = createPrivateRequest(baseUrl, config);
    const publicGet = publicFetcher(baseUrl);
    function detectQuoteAsset(symbol) {
      const upper = symbol.toUpperCase();
      const candidates = ["USDT", "USDC", "BUSD", "FDUSD", "BTC", "ETH", "BNB"];
      for (const quote of candidates) {
        if (upper.endsWith(quote)) {
          return { quote, base: upper.slice(0, upper.length - quote.length) };
        }
      }
      return { quote: "USDT", base: upper.replace("USDT", "") };
    }
    return {
      mode: "binance-spot",
      async getMarketSnapshot(symbol, interval, limit) {
        const [candles, ticker] = await Promise.all([
          publicGet("/api/v3/klines", { symbol, interval, limit }),
          publicGet("/api/v3/ticker/price", { symbol })
        ]);
        return {
          symbol,
          price: Number(ticker.price),
          fundingRate: null,
          markPrice: Number(ticker.price),
          candles
        };
      },
      async getHistoricalCandles(symbol, interval, limit) {
        return publicGet("/api/v3/klines", { symbol, interval, limit });
      },
      async placeOrder(payload) {
        if (!privateRequest) {
          throw new Error("Binance spot credentials not provided");
        }
        const params = {
          symbol: payload.symbol,
          side: payload.side,
          type: payload.type
        };
        if (payload.type === "MARKET" && payload.quoteQuantity) {
          params.quoteOrderQty = payload.quoteQuantity;
        } else {
          params.quantity = sanitizePrecision(payload.quantity, payload.quantityPrecision) || payload.quantity;
        }
        if (payload.type === "LIMIT") {
          params.timeInForce = payload.timeInForce || "GTC";
          params.price = payload.price;
        }
        return privateRequest("POST", "/api/v3/order", params);
      },
      async getAccountSnapshot(symbol) {
        if (!privateRequest) {
          throw new Error("Binance spot credentials not provided");
        }
        const account = await privateRequest("GET", "/api/v3/account");
        const { quote } = detectQuoteAsset(symbol);
        const balances = account.balances.map((b) => ({
          asset: b.asset,
          free: Number(b.free),
          locked: Number(b.locked)
        })).filter((b) => b.free + b.locked > 0);
        const quoteBalance = balances.find((b) => b.asset === quote)?.free || 0;
        return {
          balance: quoteBalance,
          equity: quoteBalance,
          balances,
          positions: balances
        };
      },
      async cancelOrder(params) {
        if (!privateRequest) {
          throw new Error("Binance spot credentials not provided");
        }
        return privateRequest("DELETE", "/api/v3/order", params);
      },
      async streamMarket(symbol, options = {}) {
        return streamBinanceFeed({
          symbol,
          channel: options.channel,
          interval: options.interval,
          limit: options.limit,
          duration_ms: options.duration_ms,
          market: "spot"
        });
      }
    };
  }
  function createBinanceClient(config) {
    const market = (config.market || "futures").toLowerCase();
    if (market === "spot") {
      return createSpotClient(config);
    }
    return createFuturesClient(config);
  }

  // trader/providers/aster.js
  function createPrivateRequest2(config) {
    if (!config.apiKey || !config.apiSecret) {
      return null;
    }
    return async function request(method, path, params = {}) {
      const timestamp = Date.now();
      const query = new URLSearchParams({
        ...normalizeParams(params),
        timestamp,
        recvWindow: params.recvWindow || config.recvWindow || 5e3
      }).toString();
      const signature = await signPayload(config.apiSecret, query);
      const url = `${ASTER_FUTURES_URL}${path}?${query}&signature=${signature}`;
      const response = await fetch(url, {
        method,
        headers: {
          "X-MBX-APIKEY": config.apiKey
        }
      });
      return handleJSON(response);
    };
  }
  function publicFetcher2() {
    return async function get(path, params = {}) {
      const qs = new URLSearchParams(normalizeParams(params)).toString();
      const url = qs ? `${ASTER_FUTURES_URL}${path}?${qs}` : `${ASTER_FUTURES_URL}${path}`;
      const response = await fetch(url);
      return handleJSON(response);
    };
  }
  function createAsterClient(config) {
    const privateRequest = createPrivateRequest2(config);
    const publicGet = publicFetcher2();
    return {
      mode: "aster-futures",
      async getMarketSnapshot(symbol, interval, limit) {
        const [candles, ticker] = await Promise.all([
          publicGet("/fapi/v1/klines", { symbol, interval, limit }),
          publicGet("/fapi/v1/ticker/price", { symbol })
        ]);
        return {
          symbol,
          price: Number(ticker.price),
          fundingRate: null,
          markPrice: Number(ticker.price),
          candles
        };
      },
      async getHistoricalCandles(symbol, interval, limit) {
        return publicGet("/fapi/v1/klines", { symbol, interval, limit });
      },
      async placeOrder(payload) {
        if (!privateRequest) {
          throw new Error("Aster credentials not provided");
        }
        const params = {
          symbol: payload.symbol,
          side: payload.side,
          type: payload.type,
          quantity: sanitizePrecision(payload.quantity, payload.quantityPrecision) || payload.quantity,
          reduceOnly: payload.reduceOnly,
          positionSide: payload.positionSide,
          timeInForce: payload.timeInForce
        };
        if (payload.type === "LIMIT" && payload.price) {
          params.price = payload.price;
        }
        return privateRequest("POST", "/fapi/v1/order", params);
      },
      async getAccountSnapshot(symbol) {
        if (!privateRequest) {
          throw new Error("Aster credentials not provided");
        }
        const account = await privateRequest("GET", "/fapi/v2/account");
        const position = account.positions?.find((p) => p.symbol === symbol) || null;
        return {
          balance: Number(account.totalWalletBalance),
          equity: Number(account.totalMarginBalance),
          positions: account.positions || [],
          selectedPosition: position
        };
      },
      async cancelOrder(params) {
        if (!privateRequest) {
          throw new Error("Aster credentials not provided");
        }
        return privateRequest("DELETE", "/fapi/v1/order", params);
      },
      async streamMarket(symbol, options = {}) {
        return streamBinanceFeed({
          symbol,
          channel: options.channel,
          interval: options.interval,
          limit: options.limit,
          duration_ms: options.duration_ms,
          market: "aster",
          endpointOverride: "wss://fstream.asterdex.com/ws"
        });
      }
    };
  }

  // trader/providers/okx.js
  function formatInstrument(symbol, market = "swap") {
    const upper = symbol.toUpperCase();
    const quotes = ["USDT", "USDC", "BTC", "ETH"];
    const quote = quotes.find((q) => upper.endsWith(q));
    if (!quote) {
      throw new Error(`Unable to derive OKX instrument from symbol ${symbol}`);
    }
    const base = upper.slice(0, upper.length - quote.length);
    const pair = `${base}-${quote}`;
    if (market === "spot") return pair;
    return `${pair}-SWAP`;
  }
  function convertInterval(interval) {
    const map = {
      "1m": "1m",
      "3m": "3m",
      "5m": "5m",
      "15m": "15m",
      "30m": "30m",
      "1h": "1H",
      "2h": "2H",
      "4h": "4H",
      "6h": "6H",
      "12h": "12H",
      "1d": "1D"
    };
    return map[interval] || "5m";
  }
  async function hmacBase64(secret, payload) {
    if (globalThis.crypto?.subtle) {
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
      const bytes = new Uint8Array(signature);
      if (typeof Buffer !== "undefined") {
        return Buffer.from(bytes).toString("base64");
      }
      if (typeof btoa === "function") {
        let binary = "";
        bytes.forEach((b) => {
          binary += String.fromCharCode(b);
        });
        return btoa(binary);
      }
      throw new Error("No base64 encoder available for OKX signing");
    }
    const { createHmac } = await import("node:crypto");
    return createHmac("sha256", secret).update(payload).digest("base64");
  }
  async function okxRequest(config, method, path, searchParams = {}, body = void 0) {
    if (!config.apiKey || !config.apiSecret || !config.passphrase) {
      throw new Error("OKX requires apiKey, apiSecret, and passphrase");
    }
    const query = new URLSearchParams(searchParams).toString();
    const requestPath = query ? `${path}?${query}` : path;
    const url = `${OKX_BASE_URL}${requestPath}`;
    const timestamp = (/* @__PURE__ */ new Date()).toISOString();
    const payload = body ? JSON.stringify(body) : "";
    const prehash = `${timestamp}${method.toUpperCase()}${requestPath}${payload}`;
    const signature = await hmacBase64(config.apiSecret, prehash);
    const headers = {
      "OK-ACCESS-KEY": config.apiKey,
      "OK-ACCESS-SIGN": signature,
      "OK-ACCESS-TIMESTAMP": timestamp,
      "OK-ACCESS-PASSPHRASE": config.passphrase,
      "Content-Type": "application/json"
    };
    const response = await fetch(url, {
      method,
      headers,
      body: payload || void 0
    });
    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch (err) {
      throw new Error(`OKX response parse error: ${err.message}`);
    }
    if (data.code !== "0") {
      throw new Error(`OKX API error ${data.code}: ${data.msg || "unknown"}`);
    }
    return data.data;
  }
  function normalizeSymbol(symbol, market) {
    return formatInstrument(symbol, market);
  }
  function buildTickerPrice(ticker) {
    if (!ticker || !ticker.length) return null;
    const entry = ticker[0];
    return Number(entry.last || entry.lastPx || entry.lastTradedPx);
  }
  function createOkxClient(config) {
    const market = (config.market || "swap").toLowerCase();
    const instIdFromSymbol = (symbol) => normalizeSymbol(symbol, market);
    return {
      mode: `okx-${market}`,
      async getMarketSnapshot(symbol, interval, limit) {
        const instId = instIdFromSymbol(symbol);
        const bar = convertInterval(interval);
        const [candles, ticker] = await Promise.all([
          okxRequest(config, "GET", "/api/v5/market/candles", { instId, bar, limit }),
          okxRequest(config, "GET", "/api/v5/market/ticker", { instId })
        ]);
        const candleData = candles.map((c) => [
          Number(c[0]),
          Number(c[1]),
          Number(c[2]),
          Number(c[3]),
          Number(c[4]),
          Number(c[5])
        ]).reverse();
        return {
          symbol,
          price: buildTickerPrice(ticker),
          fundingRate: null,
          markPrice: buildTickerPrice(ticker),
          candles: candleData
        };
      },
      async getHistoricalCandles(symbol, interval, limit) {
        const instId = instIdFromSymbol(symbol);
        const bar = convertInterval(interval);
        const candles = await okxRequest(config, "GET", "/api/v5/market/candles", { instId, bar, limit });
        return candles.map((c) => [
          Number(c[0]),
          Number(c[1]),
          Number(c[2]),
          Number(c[3]),
          Number(c[4]),
          Number(c[5])
        ]).reverse();
      },
      async placeOrder(payload) {
        const instId = instIdFromSymbol(payload.symbol);
        const ordType = payload.type === "LIMIT" ? "limit" : "market";
        const side = payload.side === "BUY" ? "buy" : "sell";
        const body = {
          instId,
          tdMode: config.tdMode || "cross",
          side,
          ordType,
          sz: sanitizePrecision(payload.quantity, payload.quantityPrecision)?.toString() || `${payload.quantity}`
        };
        if (market !== "spot") {
          body.posSide = payload.positionSide === "LONG" ? "long" : "short";
        }
        if (ordType === "limit" && payload.price) {
          body.px = payload.price.toString();
        }
        if (payload.clientOrderId) {
          body.clOrdId = payload.clientOrderId;
        }
        const result = await okxRequest(config, "POST", "/api/v5/trade/order", {}, body);
        return result?.[0] || result;
      },
      async getAccountSnapshot(symbol) {
        const instId = instIdFromSymbol(symbol);
        const balances = await okxRequest(config, "GET", "/api/v5/account/balances");
        const positions = market === "spot" ? [] : await okxRequest(config, "GET", "/api/v5/account/positions", { instId });
        return {
          balance: Number(balances?.[0]?.details?.[0]?.cashBal || 0),
          equity: Number(balances?.[0]?.details?.[0]?.eq || 0),
          positions
        };
      },
      async cancelOrder(params) {
        const instId = instIdFromSymbol(params.symbol);
        const body = {
          instId
        };
        if (params.orderId) {
          body.ordId = params.orderId;
        } else if (params.clientOrderId || params.origClientOrderId) {
          body.clOrdId = params.clientOrderId || params.origClientOrderId;
        }
        const result = await okxRequest(config, "POST", "/api/v5/trade/cancel-order", {}, body);
        return result?.[0] || result;
      },
      async streamMarket(symbol, options = {}) {
        return streamOkxFeed({
          symbol,
          channel: options.channel || "tickers",
          limit: options.limit,
          duration_ms: options.duration_ms,
          market
        });
      }
    };
  }

  // trader/shared/state.js
  function buildDefaultPaperState() {
    return {
      balance: 1e4,
      positions: [],
      orders: [],
      equityCurve: [],
      lastMarkPrice: null,
      marks: {}
    };
  }

  // trader/providers/paper.js
  async function fetchBinancePublic(path, params) {
    const qs = new URLSearchParams(normalizeParams(params)).toString();
    const url = qs ? `${BINANCE_FUTURES_URL}${path}?${qs}` : `${BINANCE_FUTURES_URL}${path}`;
    const response = await fetch(url);
    return handleJSON(response);
  }
  function createPaperClient(config) {
    const baseState = config.runtime?.paperState || buildDefaultPaperState();
    const state = JSON.parse(JSON.stringify(baseState));
    async function ensureMark(symbol) {
      if (!state.marks) {
        state.marks = {};
      }
      if (!state.marks[symbol]) {
        const ticker = await fetchBinancePublic("/fapi/v2/ticker/price", { symbol }).catch(() => ({ price: state.lastMarkPrice || 0 }));
        state.marks[symbol] = Number(ticker.price) || state.lastMarkPrice || 0;
      }
      return state.marks[symbol];
    }
    return {
      mode: "paper",
      async getMarketSnapshot(symbol, interval, limit) {
        const [candles, ticker] = await Promise.all([
          fetchBinancePublic("/fapi/v1/klines", { symbol, interval, limit }),
          fetchBinancePublic("/fapi/v2/ticker/price", { symbol })
        ]);
        state.lastMarkPrice = Number(ticker.price);
        state.marks = state.marks || {};
        state.marks[symbol] = state.lastMarkPrice;
        return {
          symbol,
          price: state.lastMarkPrice,
          fundingRate: null,
          markPrice: state.lastMarkPrice,
          candles
        };
      },
      async getHistoricalCandles(symbol, interval, limit) {
        return fetchBinancePublic("/fapi/v1/klines", { symbol, interval, limit });
      },
      async placeOrder(payload) {
        const fallbackPrice = payload.referencePrice || payload.price || 0;
        const mark = await ensureMark(payload.symbol) || fallbackPrice;
        const price = payload.type === "MARKET" ? mark : payload.price || mark || fallbackPrice;
        if (!price || price <= 0) {
          throw new Error("Unable to determine fill price for paper trade");
        }
        const fillQty = sanitizePrecision(payload.quantity, payload.quantityPrecision) || payload.quantity;
        if (!fillQty || fillQty <= 0) {
          throw new Error("Invalid paper quantity");
        }
        let position = state.positions.find((p) => p.symbol === payload.symbol);
        if (!position) {
          position = { symbol: payload.symbol, quantity: 0, entryPrice: price };
          state.positions.push(position);
        }
        const direction = payload.side === "BUY" ? 1 : -1;
        const prevQty = position.quantity;
        const tradeQty = direction * fillQty;
        let closingQty = 0;
        let realizedPnl = 0;
        if (prevQty !== 0 && Math.sign(prevQty) !== Math.sign(tradeQty)) {
          closingQty = Math.min(Math.abs(prevQty), Math.abs(tradeQty));
          realizedPnl = (price - position.entryPrice) * closingQty * Math.sign(prevQty);
          position.quantity = prevQty - Math.sign(prevQty) * closingQty;
        }
        const tradeSign = tradeQty === 0 ? 0 : Math.sign(tradeQty);
        const remainingQty = tradeQty - tradeSign * closingQty;
        if (remainingQty !== 0) {
          const newQty = position.quantity + remainingQty;
          const weightPrev = Math.abs(position.quantity);
          const weightNew = Math.abs(remainingQty);
          position.entryPrice = (weightPrev * position.entryPrice + weightNew * price) / (weightPrev + weightNew || 1);
          position.quantity = newQty;
        }
        if (position.quantity === 0) {
          position.entryPrice = price;
        }
        state.balance += realizedPnl;
        const equity = state.balance + state.positions.reduce((sum, pos) => {
          const markPrice = state.marks?.[pos.symbol] ?? state.lastMarkPrice ?? price;
          return sum + pos.quantity * markPrice;
        }, 0);
        const order = {
          id: `paper-${Date.now()}`,
          status: "FILLED",
          price,
          quantity: fillQty,
          side: payload.side,
          symbol: payload.symbol,
          timestamp: Date.now(),
          realizedPnl,
          equity
        };
        state.orders.push(order);
        state.equityCurve.push({ time: Date.now(), balance: state.balance, equity });
        return { order, paperState: state };
      },
      async getAccountSnapshot(symbol) {
        const markMap = state.marks || {};
        const equity = state.balance + state.positions.reduce((sum, pos) => {
          const mark = markMap[pos.symbol] || state.lastMarkPrice || pos.entryPrice;
          return sum + pos.quantity * mark;
        }, 0);
        return {
          balance: state.balance,
          equity,
          positions: state.positions,
          orders: state.orders.slice(-20),
          paperState: state
        };
      },
      async cancelOrder(params) {
        state.orders = state.orders.filter((o) => o.id !== params.orderId && o.clientOrderId !== params.origClientOrderId);
        return { cancelled: true, paperState: state };
      },
      async streamMarket(symbol, options = {}) {
        const limit = options.limit || 20;
        const interval_ms = Math.max((options.duration_ms || 5e3) / limit, 50);
        const samples = [];
        let last = state.marks?.[symbol] ?? state.lastMarkPrice ?? 1e3;
        for (let i = 0; i < limit; i++) {
          const delta = (Math.random() - 0.5) * (last * 1e-3);
          last = Math.max(1e-4, last + delta);
          samples.push({
            eventTime: Date.now(),
            price: Number(last.toFixed(4)),
            bestBid: Number((last - 0.5 * Math.abs(delta)).toFixed(4)),
            bestAsk: Number((last + 0.5 * Math.abs(delta)).toFixed(4))
          });
        }
        await new Promise((resolve) => setTimeout(resolve, interval_ms * limit));
        return {
          provider: "paper",
          channel: options.channel || "simulated",
          symbol,
          samples,
          stats: {
            count: samples.length,
            duration_ms: interval_ms * limit
          }
        };
      }
    };
  }

  // trader/providers/factory.js
  var PROVIDERS = {
    binance: createBinanceClient,
    aster: createAsterClient,
    okx: createOkxClient,
    paper: createPaperClient
  };
  function createExchangeClient(runtimeConfig) {
    const exchangeConfig = runtimeConfig.exchange || {};
    const providerKey = (exchangeConfig.provider || "binance").toLowerCase();
    const factory = PROVIDERS[providerKey];
    if (!factory) {
      throw new Error(`Unsupported exchange provider: ${exchangeConfig.provider}`);
    }
    return factory({ ...exchangeConfig, runtime: runtimeConfig });
  }

  // trader/index.js
  var DEFAULT_INTERVAL = "5m";
  var DEFAULT_CANDLE_LIMIT = 120;
  var PACKAGE_NAME = "@maitask/trader";
  var PACKAGE_VERSION = "0.1.0";
  async function execute(input = {}, options = {}, context = {}) {
    ensureFetch();
    ensureCrypto();
    const startedAt = Date.now();
    try {
      const config = buildConfig(input, options, context);
      const exchange = await createExchangeClient(config);
      let payload;
      switch (config.action) {
        case "analyze":
          payload = await performAnalysis(config, exchange);
          break;
        case "execute":
          payload = await performExecution(config, exchange);
          break;
        case "status":
          payload = await fetchStatus(config, exchange);
          break;
        case "cancel":
          payload = await cancelOrder(config, exchange);
          break;
        case "backtest":
          payload = await runBacktest(config, exchange);
          break;
        case "stream":
          payload = await performStream(config, exchange);
          break;
        default:
          throw new Error(`Unsupported action: ${config.action}`);
      }
      return successResponse(payload, config, exchange, context, startedAt);
    } catch (error) {
      return errorResponse(error, input, options, context, startedAt);
    }
  }
  function successResponse(payload, config, exchange, context, startedAt) {
    return {
      success: true,
      data: {
        items: [
          {
            index: 0,
            data: payload
          }
        ],
        summary: {
          total: 1,
          success_count: 1,
          failure_count: 0,
          metrics: {
            action: config.action,
            provider: config.exchange?.provider,
            mode: exchange?.mode || null
          }
        }
      },
      error: null,
      metadata: {
        contract_version: "2026-06-27",
        package: PACKAGE_NAME,
        version: PACKAGE_VERSION,
        execution_id: context?.execution_id || null,
        execution_ms: Date.now() - startedAt,
        action: config.action,
        symbol: config.symbol,
        provider: config.exchange?.provider,
        mode: exchange?.mode || null,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      },
      citations: []
    };
  }
  function errorResponse(error, input = {}, options = {}, context = {}, startedAt = Date.now()) {
    const source = mergeObjects(options, input);
    return {
      success: false,
      data: {
        items: [],
        summary: {
          total: 0,
          success_count: 0,
          failure_count: 1
        }
      },
      error: {
        message: error?.message || "Unknown trader error",
        code: error?.code || "TRADER_ERROR",
        type: error?.name || "TraderError",
        details: null
      },
      metadata: {
        contract_version: "2026-06-27",
        package: PACKAGE_NAME,
        version: PACKAGE_VERSION,
        execution_id: context?.execution_id || null,
        execution_ms: Date.now() - startedAt,
        action: source.action || "analyze",
        symbol: source.symbol || "BTCUSDT",
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      },
      citations: []
    };
  }
  function buildConfig(input, options, context) {
    const source = mergeObjects(options, input);
    const action = (source.action || "analyze").toLowerCase();
    const exchange = source.exchange || {};
    exchange.provider = (exchange.provider || source.provider || "binance").toLowerCase();
    const defaultMarket = exchange.provider === "binance" ? "futures" : exchange.provider === "paper" ? "paper" : "swap";
    exchange.market = (exchange.market || source.market || defaultMarket).toLowerCase();
    const defaultTestnet = exchange.provider === "binance" ? true : false;
    exchange.testnet = exchange.testnet ?? source.testnet ?? defaultTestnet;
    exchange.apiKey = exchange.apiKey || exchange.api_key || source.apiKey || source.api_key || context?.secrets?.BINANCE_API_KEY;
    exchange.apiSecret = exchange.apiSecret || exchange.api_secret || source.apiSecret || source.api_secret || context?.secrets?.BINANCE_API_SECRET;
    exchange.passphrase = exchange.passphrase || source.passphrase || context?.secrets?.OKX_PASSPHRASE;
    if (!exchange.apiKey) {
      if (exchange.provider === "okx") {
        exchange.apiKey = context?.secrets?.OKX_API_KEY;
      } else if (exchange.provider === "aster") {
        exchange.apiKey = context?.secrets?.ASTER_API_KEY;
      }
    }
    if (!exchange.apiSecret) {
      if (exchange.provider === "okx") {
        exchange.apiSecret = context?.secrets?.OKX_API_SECRET;
      } else if (exchange.provider === "aster") {
        exchange.apiSecret = context?.secrets?.ASTER_API_SECRET;
      }
    }
    if (!exchange.passphrase && exchange.provider === "okx") {
      exchange.passphrase = context?.secrets?.OKX_PASSPHRASE;
    }
    return {
      action,
      symbol: (source.symbol || "BTCUSDT").toUpperCase(),
      interval: source.interval || DEFAULT_INTERVAL,
      candleLimit: Math.min(Math.max(source.candles || source.candleLimit || DEFAULT_CANDLE_LIMIT, 20), 1e3),
      strategy: source.strategy || {},
      decision: source.decision,
      quantity: toNumber(source.quantity),
      quoteQuantity: toNumber(source.quoteQuantity || source.notional),
      price: toNumber(source.price),
      leverage: Math.min(toNumber(source.leverage) || 1, source.maxLeverage || 50),
      execution: source.execution || {},
      risk: buildRiskConfig(source),
      performance: source.performance || {},
      exchange,
      paperState: source.paperState || buildDefaultPaperState(),
      backtest: source.backtest || {},
      stream: source.stream || {}
    };
  }
  function buildRiskConfig(source) {
    const positionRiskPct = clamp(toNumber(source.positionRiskPct ?? source?.risk?.positionRiskPct), 1e-4, 1, 0.02);
    const slippageBps = clamp(toNumber(source.slippageBps ?? source?.risk?.slippageBps), 0, 5e3, 5);
    const stopLossPct = clamp(toNumber(source.stopLossPct ?? source?.risk?.stopLossPct), 1e-4, 1, 0.01);
    const takeProfitPct = clamp(toNumber(source.takeProfitPct ?? source?.risk?.takeProfitPct), 1e-4, 5, 0.02);
    return {
      maxDailyLoss: toNumber(source.maxDailyLoss ?? source?.risk?.maxDailyLoss),
      maxDrawdown: toNumber(source.maxDrawdown ?? source?.risk?.maxDrawdown),
      maxPositionSize: toNumber(source.maxPositionSize ?? source?.risk?.maxPositionSize),
      positionRiskPct,
      slippageBps,
      stopLossPct,
      takeProfitPct,
      allowShort: source.allowShort ?? source?.risk?.allowShort ?? true,
      allowLong: source.allowLong ?? source?.risk?.allowLong ?? true
    };
  }
  async function performAnalysis(config, exchange) {
    const snapshot = await exchange.getMarketSnapshot(config.symbol, config.interval, config.candleLimit);
    const indicators = buildIndicators(snapshot.candles, config.strategy);
    const decision = deriveDecision(indicators, config);
    const risk = evaluateRisk(decision, config);
    return {
      mode: exchange.mode,
      symbol: config.symbol,
      analysis: {
        decision,
        indicators,
        risk,
        market: snapshot
      }
    };
  }
  async function performExecution(config, exchange) {
    const snapshot = await exchange.getMarketSnapshot(config.symbol, config.interval, config.candleLimit);
    const indicators = buildIndicators(snapshot.candles, config.strategy);
    const baseDecision = config.decision || deriveDecision(indicators, config);
    const risk = evaluateRisk(baseDecision, config);
    if (!risk.allowed) {
      return {
        status: "blocked",
        reason: "Risk limits prevent execution",
        risk,
        analysis: { decision: baseDecision, indicators, market: snapshot }
      };
    }
    if (baseDecision.signal === "flat") {
      return {
        status: "skipped",
        reason: "Decision returned flat signal",
        analysis: { decision: baseDecision, indicators, market: snapshot }
      };
    }
    const orderSide = baseDecision.signal === "long" ? "BUY" : "SELL";
    if (orderSide === "SELL" && !config.risk.allowShort) {
      throw new Error("Short trades disallowed by configuration");
    }
    if (orderSide === "BUY" && !config.risk.allowLong) {
      throw new Error("Long trades disallowed by configuration");
    }
    const price = config.price || snapshot.price;
    const quantity = determineQuantity(config, price);
    if (!quantity || quantity <= 0) {
      throw new Error("Unable to determine a valid order quantity");
    }
    const orderRequest = {
      symbol: config.symbol,
      side: orderSide,
      type: (config.execution.type || "MARKET").toUpperCase(),
      quantity,
      quoteQuantity: config.quoteQuantity,
      price: config.price || (config.execution.type && config.execution.type.toUpperCase() === "LIMIT" ? price : void 0),
      leverage: config.leverage,
      positionSide: baseDecision.signal === "long" ? "LONG" : "SHORT",
      reduceOnly: config.execution.reduceOnly ?? false,
      timeInForce: config.execution.timeInForce || "GTC",
      clientOrderId: config.execution.clientOrderId,
      referencePrice: snapshot.price,
      stopLossPct: config.risk.stopLossPct,
      takeProfitPct: config.risk.takeProfitPct
    };
    const orderResult = await exchange.placeOrder(orderRequest);
    const orderDetails = orderResult?.order || orderResult;
    const status = await exchange.getAccountSnapshot(config.symbol);
    const targets = buildTargets(orderSide, snapshot.price, config.risk);
    return {
      status: "executed",
      order: orderDetails,
      paperState: orderResult?.paperState || status?.paperState,
      account: status,
      targets,
      analysis: {
        decision: baseDecision,
        indicators,
        market: snapshot
      },
      risk
    };
  }
  async function performStream(config, exchange) {
    if (typeof exchange.streamMarket !== "function") {
      throw new Error(`Provider ${config.exchange.provider} does not support streaming subscriptions`);
    }
    const streamOptions = {
      channel: config.stream?.channel || "bookTicker",
      interval: config.stream?.interval || config.interval || "1m",
      limit: config.stream?.limit || config.stream?.message_limit || 20,
      duration_ms: config.stream?.duration_ms || config.stream?.window_ms || 5e3
    };
    const stream = await exchange.streamMarket(config.symbol, streamOptions);
    return {
      status: "streamed",
      stream,
      metadata: {
        provider: config.exchange.provider,
        channel: streamOptions.channel,
        message_limit: streamOptions.limit,
        duration_ms: streamOptions.duration_ms
      }
    };
  }
  async function fetchStatus(config, exchange) {
    const status = await exchange.getAccountSnapshot(config.symbol);
    return { status: "ok", account: status };
  }
  async function cancelOrder(config, exchange) {
    if (!config.execution.orderId && !config.execution.clientOrderId) {
      throw new Error("Provide execution.orderId or execution.clientOrderId for cancel action");
    }
    const result = await exchange.cancelOrder({
      symbol: config.symbol,
      orderId: config.execution.orderId,
      origClientOrderId: config.execution.clientOrderId
    });
    return { status: "cancelled", order: result?.order || result, paperState: result?.paperState };
  }
  async function runBacktest(config, exchange) {
    const data = config.backtest?.candles || await exchange.getHistoricalCandles(config.symbol, config.interval, config.candleLimit * 5);
    if (!Array.isArray(data) || data.length < 20) {
      throw new Error("Not enough candles for backtest");
    }
    const strategy = config.strategy || {};
    const initialBalance = config.backtest?.capital || 1e4;
    let balance = initialBalance;
    let position = 0;
    let entryPrice = 0;
    let trades = [];
    for (let i = 20; i < data.length; i++) {
      const segment = data.slice(0, i + 1);
      const indicators = buildIndicators(segment, strategy);
      const decision = deriveDecision(indicators, config);
      const price = Number(segment[segment.length - 1][4]);
      if (decision.signal === "long" && position <= 0) {
        if (position < 0) {
          balance += (entryPrice - price) * Math.abs(position);
          trades.push({ type: "cover", price, size: Math.abs(position), balance });
          position = 0;
        }
        const qty = determineQuantity({ ...config, quantity: void 0, quoteQuantity: balance * config.risk.positionRiskPct }, price);
        if (qty > 0) {
          position += qty;
          entryPrice = price;
          balance -= price * qty;
          trades.push({ type: "buy", price, size: qty, balance });
        }
      } else if (decision.signal === "short" && position >= 0) {
        if (position > 0) {
          balance += (price - entryPrice) * position;
          trades.push({ type: "sell", price, size: position, balance });
          position = 0;
        }
        if (config.risk.allowShort) {
          const qty = determineQuantity({ ...config, quantity: void 0, quoteQuantity: balance * config.risk.positionRiskPct }, price);
          if (qty > 0) {
            position -= qty;
            entryPrice = price;
            trades.push({ type: "short", price, size: qty, balance });
          }
        }
      }
    }
    const finalPrice = Number(data[data.length - 1][4]);
    const finalBalance = balance + position * finalPrice;
    const roi = (finalBalance - initialBalance) / initialBalance;
    return {
      status: "completed",
      statistics: {
        trades: trades.length,
        finalBalance,
        roi,
        maxDrawdown: Math.abs(computeMaxDrawdown(trades, initialBalance))
      },
      trades
    };
  }
  function buildIndicators(candles, strategy) {
    const closes = candles.map((c) => Number(c[4]));
    const fast = strategy.fastLength || 9;
    const slow = strategy.slowLength || 26;
    const rsiPeriod = strategy.rsiLength || 14;
    const emaPeriod = strategy.emaLength || 21;
    const volatilityPeriod = strategy.volatilityLength || 20;
    const momentumLookback = strategy.momentumLookback || 5;
    const lastClose = closes.at(-1);
    const lookbackIndex = Math.max(closes.length - 1 - Math.min(momentumLookback, closes.length - 1), 0);
    const referencePrice = closes[lookbackIndex] ?? lastClose;
    return {
      price: lastClose,
      smaFast: simpleMovingAverage(closes, fast),
      smaSlow: simpleMovingAverage(closes, slow),
      ema: exponentialMovingAverage(closes, emaPeriod),
      rsi: relativeStrengthIndex(closes, rsiPeriod),
      volatility: rollingStdDev(closes, volatilityPeriod),
      momentum: lastClose - referencePrice,
      closes
    };
  }
  function deriveDecision(indicators, config) {
    const strategyType = (config.strategy?.type || "sma-crossover").toLowerCase();
    let signal = "flat";
    let confidence = 0.5;
    let reason = "Neutral";
    if (strategyType === "sma-crossover") {
      if (indicators.smaFast > indicators.smaSlow) {
        signal = "long";
        confidence = sigmoid(indicators.momentum || 0);
        reason = "Fast SMA above slow SMA";
      } else if (indicators.smaFast < indicators.smaSlow) {
        signal = "short";
        confidence = sigmoid(-(indicators.momentum || 0));
        reason = "Fast SMA below slow SMA";
      }
    } else if (strategyType === "rsi-mean-reversion") {
      const lower = config.strategy.lowerBand || 30;
      const upper = config.strategy.upperBand || 70;
      if (indicators.rsi < lower) {
        signal = "long";
        confidence = 1 - indicators.rsi / lower;
        reason = `RSI ${indicators.rsi.toFixed(2)} below ${lower}`;
      } else if (indicators.rsi > upper && config.risk.allowShort) {
        signal = "short";
        confidence = (indicators.rsi - upper) / (100 - upper);
        reason = `RSI ${indicators.rsi.toFixed(2)} above ${upper}`;
      }
    } else if (strategyType === "momentum-breakout") {
      const momentum = indicators.momentum || 0;
      if (momentum > 0) {
        signal = "long";
        confidence = sigmoid(momentum);
        reason = "Positive momentum breakout";
      } else if (momentum < 0 && config.risk.allowShort) {
        signal = "short";
        confidence = sigmoid(-momentum);
        reason = "Negative momentum breakdown";
      }
    } else if (strategyType === "manual") {
      signal = (config.strategy.manualSignal || "flat").toLowerCase();
      confidence = config.strategy.confidence || 0.5;
      reason = config.strategy.reason || "Manual override";
    }
    return { signal, confidence, reason };
  }
  function evaluateRisk(decision, config) {
    const reasons = [];
    const dailyLoss = toNumber(config.performance?.dailyLoss);
    if (dailyLoss !== void 0 && config.risk.maxDailyLoss && dailyLoss <= -Math.abs(config.risk.maxDailyLoss)) {
      reasons.push(`Daily loss ${dailyLoss} exceeds limit ${config.risk.maxDailyLoss}`);
    }
    const drawdown = toNumber(config.performance?.drawdown);
    if (drawdown !== void 0 && config.risk.maxDrawdown && Math.abs(drawdown) >= Math.abs(config.risk.maxDrawdown)) {
      reasons.push(`Drawdown ${drawdown} exceeds limit ${config.risk.maxDrawdown}`);
    }
    if (decision.signal === "short" && !config.risk.allowShort) {
      reasons.push("Short trades disabled");
    }
    if (decision.signal === "long" && !config.risk.allowLong) {
      reasons.push("Long trades disabled");
    }
    return {
      allowed: reasons.length === 0,
      reasons
    };
  }
  function buildTargets(side, price, risk) {
    if (!price) return null;
    const stopPct = risk.stopLossPct || 0.01;
    const takePct = risk.takeProfitPct || 0.02;
    const stopLoss = side === "BUY" ? price * (1 - stopPct) : price * (1 + stopPct);
    const takeProfit = side === "BUY" ? price * (1 + takePct) : price * (1 - takePct);
    return {
      stopLoss,
      takeProfit,
      riskReward: takePct / stopPct
    };
  }
  function determineQuantity(config, price) {
    if (config.quantity) {
      return sanitizePrecision(config.quantity, config.execution.quantityPrecision);
    }
    if (config.quoteQuantity) {
      return sanitizePrecision(config.quoteQuantity / price, config.execution.quantityPrecision);
    }
    const equity = config.performance?.equity || config.paperState?.balance || 1e4;
    const notional = equity * (config.risk.positionRiskPct || 0.02) * (config.leverage || 1);
    let quantity = notional / price;
    if (config.risk.maxPositionSize) {
      quantity = Math.min(quantity, config.risk.maxPositionSize);
    }
    return sanitizePrecision(quantity, config.execution.quantityPrecision);
  }
  function simpleMovingAverage(values, period) {
    if (!values?.length || values.length < period) return values.at(-1);
    const subset = values.slice(-period);
    return subset.reduce((sum, v) => sum + v, 0) / period;
  }
  function exponentialMovingAverage(values, period) {
    if (!values?.length) return void 0;
    const k = 2 / (period + 1);
    let ema = values[0];
    for (let i = 1; i < values.length; i++) {
      ema = values[i] * k + ema * (1 - k);
    }
    return ema;
  }
  function relativeStrengthIndex(values, period) {
    if (!values || values.length <= period) return 50;
    let gains = 0;
    let losses = 0;
    for (let i = values.length - period; i < values.length; i++) {
      const change = values[i] - values[i - 1];
      if (change > 0) gains += change;
      else losses -= change;
    }
    if (losses === 0) return 100;
    const rs = gains / losses;
    return 100 - 100 / (1 + rs);
  }
  function rollingStdDev(values, period) {
    if (!values || values.length < period) return 0;
    const subset = values.slice(-period);
    const mean = subset.reduce((sum, v) => sum + v, 0) / subset.length;
    const variance = subset.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / subset.length;
    return Math.sqrt(variance);
  }
  function sigmoid(x) {
    return 1 / (1 + Math.exp(-x));
  }
  function computeMaxDrawdown(trades, initialBalance) {
    if (!trades.length) return 0;
    let peak = initialBalance;
    let maxDD = 0;
    for (const trade of trades) {
      peak = Math.max(peak, trade.balance);
      const dd = (trade.balance - peak) / peak;
      maxDD = Math.min(maxDD, dd);
    }
    return maxDD;
  }
  function clamp(value, min, max, fallback) {
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, value));
  }
  return __toCommonJS(index_exports);
})();
var execute = TraderPackage.execute; if (typeof module !== 'undefined') { module.exports = { execute }; }
