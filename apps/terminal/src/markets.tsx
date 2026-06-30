/* =============================================================================
 * AmpliFi terminal — live market charts (TradingView)
 * -----------------------------------------------------------------------------
 * Embeds TradingView mini-symbol-overview widgets for the tokens the exposure
 * engine is currently trading. The widgets load client-side in the browser and
 * stream real price data, so the "Live Markets" panel shows the actual market
 * each AmpliFi leg is built on. No data is fetched server-side.
 * ===========================================================================*/

import { useEffect, useRef } from "react";

/** Map each AmpliFi underlying to a TradingView symbol. */
export const TV_SYMBOL: Record<string, string> = {
  BTC: "BINANCE:BTCUSDT",
  ETH: "BINANCE:ETHUSDT",
  SOL: "BINANCE:SOLUSDT",
  BNB: "BINANCE:BNBUSDT",
  AVAX: "BINANCE:AVAXUSDT",
  XRP: "BINANCE:XRPUSDT",
  DOGE: "BINANCE:DOGEUSDT",
  ADA: "BINANCE:ADAUSDT",
  LINK: "BINANCE:LINKUSDT",
  DOT: "BINANCE:DOTUSDT",
  LTC: "BINANCE:LTCUSDT",
  ATOM: "BINANCE:ATOMUSDT",
  ARB: "BINANCE:ARBUSDT",
  OP: "BINANCE:OPUSDT",
  GOLD: "OANDA:XAUUSD",
  SILVER: "OANDA:XAGUSD",
  COPPER: "OANDA:XCUUSD",
  OIL: "TVC:USOIL",
  NATGAS: "TVC:NATGAS",
  SP500: "OANDA:SPX500USD",
  NDX: "OANDA:NAS100USD",
  EURUSD: "FX:EURUSD",
};

/** A single TradingView mini chart, mounted by injecting the embed script. */
function TVMini({ sym, tv }: { sym: string; tv: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    el.innerHTML = "";
    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget";
    el.appendChild(widget);
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-mini-symbol-overview.js";
    script.async = true;
    script.type = "text/javascript";
    script.innerHTML = JSON.stringify({
      symbol: tv,
      width: "100%",
      height: "100%",
      locale: "en",
      dateRange: "3M",
      colorTheme: "dark",
      isTransparent: true,
      autosize: true,
      noTimeScale: false,
    });
    el.appendChild(script);
    return () => {
      el.innerHTML = "";
    };
  }, [tv]);
  return (
    <div className="tv-card">
      <div className="tv-head">
        <span className="tv-sym">{sym}</span>
        <span className="tv-tick">{tv}</span>
      </div>
      <div className="tradingview-widget-container" ref={host} />
    </div>
  );
}

/** Grid of live charts for the currently-active exposure tokens. */
export function MarketsPanel({ syms }: { syms: string[] }) {
  const known = syms.filter((s) => TV_SYMBOL[s]);
  return (
    <div className="panel-body">
      <div className="tv-grid">
        {known.map((s) => (
          <TVMini key={s} sym={s} tv={TV_SYMBOL[s]} />
        ))}
      </div>
      <p className="panel-note">Live prices via TradingView for every underlying the exposure engine is currently trading. Add or remove tokens in the Exposure Universe panel.</p>
    </div>
  );
}
