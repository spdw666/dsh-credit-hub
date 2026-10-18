export const styles = String.raw`
.credit-hub {
  --hub-bg: var(--dsw-alias-bg-base, #fff);
  --hub-layer: var(--dsw-alias-bg-layer-1, #f7f8fa);
  --hub-text: var(--dsw-alias-label-primary, #202124);
  --hub-muted: var(--dsw-alias-label-secondary, #5d6470);
  --hub-line: var(--dsw-alias-border-l3, #e4e7ec);
  --hub-accent: var(--dsw-alias-brand-primary, #4169e1);
  --hub-accent-text: var(--dsw-alias-brand-text, #315bc9);
  --hub-action-bg: var(--dsw-alias-button-primary-fill, #1b1b1c);
  --hub-action-text: var(--dsw-alias-label-primary-foreground, #fff);
  --hub-action-hover: var(--dsw-alias-button-primary-hover, #43454a);
  --hub-disabled-bg: var(--dsw-alias-button-primary-dimmed, #ebeef2);
  --hub-hover: var(--dsw-alias-interactive-bg-hover, #f0f2f6);
  --hub-selected: var(--dsw-alias-interactive-bg-active, #edf2ff);
  --hub-space-xs: 4px; --hub-space-sm: 8px; --hub-space-md: 12px;
  --hub-space-lg: 16px; --hub-space-xl: 24px;
  --hub-radius: 8px; --hub-row: 44px;
  container-name: credit-hub; container-type: inline-size;
  box-sizing: border-box; width: 100%; height: 100%; min-height: 0;
  color: var(--hub-text); background: var(--hub-bg);
  font: 14px/1.55 var(--dsh-font-family-text, inherit);
  overflow: auto; scrollbar-color: var(--dsw-alias-scrollbar-bg-l2, #bdc2cc) transparent;
}
.credit-hub *, .credit-hub *::before, .credit-hub *::after { box-sizing: border-box; }
.credit-hub ::selection { background: var(--hub-selected); color: var(--hub-text); }
.credit-hub input, .credit-hub select { caret-color: var(--hub-accent); }
.credit-hub :focus-visible { outline: 2px solid var(--hub-accent); outline-offset: 3px; }
.credit-hub__inner { padding: var(--hub-space-xl); max-width: 1360px; min-width: 0; margin: 0 auto; }
.credit-hub__header { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--hub-space-lg); }
.credit-hub h1 { font-size: 22px; line-height: 1.4; font-weight: 650; margin: 0 0 var(--hub-space-xs); }
.credit-hub h2 { font-size: 16px; font-weight: 600; margin: var(--hub-space-xl) 0 var(--hub-space-sm); }
.credit-hub p { margin: 0 0 var(--hub-space-md); max-width: 74ch; }
.credit-hub__muted { color: var(--hub-muted); }
.credit-hub__summary { display: flex; flex-wrap: wrap; gap: var(--hub-space-sm) var(--hub-space-xl); margin: var(--hub-space-lg) 0; font-size: 13px; color: var(--hub-muted); }
.credit-hub__summary strong { color: var(--hub-text); font-weight: 600; margin-left: var(--hub-space-xs); font-variant-numeric: tabular-nums; }
.credit-hub__tabs { display: flex; gap: var(--hub-space-xs); border-bottom: 1px solid var(--hub-line); overflow-x: auto; margin: 0 0 var(--hub-space-xl); }
.credit-hub__tab { position: relative; flex: 0 0 auto; border: 0; padding: var(--hub-space-md) var(--hub-space-lg); color: var(--hub-muted); background: transparent; font: inherit; cursor: pointer; }
.credit-hub__tab:hover { color: var(--hub-text); background: var(--hub-hover); }
.credit-hub__tab[aria-selected="true"] { color: var(--hub-accent-text); font-weight: 600; }
.credit-hub__tab[aria-selected="true"]::after { content: ''; position: absolute; left: var(--hub-space-lg); right: var(--hub-space-lg); bottom: 0; height: 2px; background: var(--hub-accent); }
.credit-hub__toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--hub-space-sm); margin: 0 0 var(--hub-space-lg); }
.credit-hub__toolbar > .credit-hub__search { flex: 1 1 220px; max-width: 380px; }
.credit-hub button.credit-hub__button { min-height: 34px; border: 1px solid var(--hub-line); border-radius: var(--hub-radius); padding: var(--hub-space-xs) var(--hub-space-md); color: var(--hub-text); background: var(--hub-bg); font: inherit; cursor: pointer; white-space: nowrap; }
.credit-hub button.credit-hub__button:hover:not(:disabled) { background: var(--hub-hover); }
.credit-hub button.credit-hub__button--primary { color: var(--hub-action-text); border-color: transparent; background: var(--hub-action-bg); }
.credit-hub button.credit-hub__button--primary:hover:not(:disabled) { background: var(--hub-action-hover); }
.credit-hub button.credit-hub__button:disabled, .credit-hub input:disabled, .credit-hub select:disabled { opacity: 1; cursor: not-allowed; color: var(--hub-muted); background: var(--hub-disabled-bg); border-color: var(--hub-line); }
.credit-hub input:not([type="checkbox"]), .credit-hub select { min-height: 34px; max-width: 100%; border: 1px solid var(--hub-line); border-radius: var(--hub-radius); padding: var(--hub-space-xs) var(--hub-space-sm); background: var(--hub-bg); color: var(--hub-text); font: inherit; }
.credit-hub input::placeholder { color: var(--hub-muted); opacity: 1; }
.credit-hub input[type="checkbox"] { width: 16px; height: 16px; accent-color: var(--hub-accent); margin: 0 var(--hub-space-sm) 0 0; vertical-align: middle; }
.credit-hub__check { display: inline-flex; align-items: center; min-height: 34px; gap: var(--hub-space-xs); cursor: pointer; white-space: nowrap; }
.credit-hub__table-wrap { max-width: 100%; overflow-x: auto; border-top: 1px solid var(--hub-line); }
.credit-hub table { width: 100%; min-width: 660px; border-collapse: collapse; text-align: left; color: var(--hub-text); font-variant-numeric: tabular-nums; }
.credit-hub th:first-child, .credit-hub td:first-child { min-width: 150px; width: 185px; }
.credit-hub th { padding: var(--hub-space-md); font-size: 12px; font-weight: 500; color: var(--hub-muted); background: var(--hub-layer); white-space: nowrap; }
.credit-hub td { height: var(--hub-row); border-bottom: 1px solid var(--hub-line); padding: var(--hub-space-sm) var(--hub-space-md); vertical-align: middle; }
.credit-hub tbody tr:hover { background: var(--hub-hover); }
.credit-hub__cell-main { display: block; font-weight: 550; }
.credit-hub__cell-detail { display: block; color: var(--hub-muted); font-size: 12px; margin-top: 2px; max-width: 480px; overflow-wrap: anywhere; }
.credit-hub__badge { display: inline-flex; align-items: center; gap: 6px; color: var(--hub-muted); font-size: 12px; white-space: nowrap; }
.credit-hub__badge::before { content: ''; width: 6px; height: 6px; flex: 0 0 auto; border-radius: 50%; background: currentColor; }
.credit-hub__badge--enabled { color: var(--dsw-alias-state-success, #26734d); }
.credit-hub__badge--pending { color: var(--dsw-alias-state-warning, #8b6516); }
.credit-hub__notice { padding: var(--hub-space-md) var(--hub-space-lg); background: var(--hub-layer); border-radius: var(--hub-radius); margin-bottom: var(--hub-space-lg); }
.credit-hub__notice p:last-child { margin-bottom: 0; }
.credit-hub__notice--error { color: var(--dsw-alias-state-danger, #b33c35); }
.credit-hub__empty { padding: 48px var(--hub-space-xl); text-align: center; color: var(--hub-muted); }
.credit-hub__empty strong { display: block; font-weight: 550; color: var(--hub-text); margin-bottom: var(--hub-space-sm); }
.credit-hub__form { max-width: 640px; display: grid; grid-template-columns: minmax(130px, 180px) minmax(0, 1fr); gap: var(--hub-space-lg); align-items: center; margin-top: var(--hub-space-lg); }
.credit-hub__form label { color: var(--hub-muted); }
.credit-hub__form .credit-hub__wide { grid-column: 1 / -1; }
.credit-hub__form input[type="number"] { width: 130px; }
.credit-hub__kv { display: grid; grid-template-columns: minmax(120px, 180px) minmax(0, 1fr); max-width: 760px; gap: var(--hub-space-sm) var(--hub-space-lg); }
.credit-hub__kv dt { color: var(--hub-muted); }
.credit-hub__kv dd { margin: 0; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.credit-hub__progress { height: 6px; width: 100%; background: var(--hub-line); border-radius: 3px; overflow: hidden; margin: var(--hub-space-sm) 0; }
.credit-hub__progress > span { display: block; height: 100%; background: var(--hub-accent); transition: width .2s ease-out; }
.credit-hub__inline-form { display: flex; flex-wrap: wrap; gap: var(--hub-space-sm); margin: 0 0 var(--hub-space-lg); }
.credit-hub__transfer { margin-bottom: var(--hub-space-xl); padding: var(--hub-space-lg); border: 1px solid var(--hub-line); border-radius: var(--hub-radius); }
.credit-hub__transfer h2 { margin-top: 0; }
.credit-hub__transfer-file { display: grid; gap: var(--hub-space-sm); margin-bottom: var(--hub-space-lg); }
.credit-hub__transfer-file input::file-selector-button { font: inherit; color: var(--hub-text); background: var(--hub-layer); border: 1px solid var(--hub-line); border-radius: 4px; padding: var(--hub-space-xs) var(--hub-space-sm); margin-right: var(--hub-space-sm); cursor: pointer; }
.credit-hub__transfer-list { max-height: 240px; overflow: auto; margin-bottom: var(--hub-space-lg); }
.credit-hub__transfer-list .credit-hub__check { display: flex; white-space: normal; overflow-wrap: anywhere; }
.credit-hub__transfer-status { margin-top: var(--hub-space-md); overflow-wrap: anywhere; }
.credit-hub__text-button { appearance: none; padding: 0; border: 0; font: inherit; background: transparent; color: var(--hub-accent-text); text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
.credit-hub__result { margin-top: var(--hub-space-xl); padding-top: var(--hub-space-lg); border-top: 1px solid var(--hub-line); }
.credit-hub__result h2 { margin-top: 0; }
.credit-hub details { margin: var(--hub-space-md) 0; }
.credit-hub summary { cursor: pointer; padding: var(--hub-space-sm) 0; color: var(--hub-text); }
.credit-hub section[aria-label] + section[aria-label] { margin-top: var(--hub-space-xl); padding-top: var(--hub-space-lg); border-top: 1px solid var(--hub-line); }
@container credit-hub (max-width: 680px) {
  .credit-hub__inner { padding: var(--hub-space-lg); }
  .credit-hub__header { flex-wrap: wrap; }
  .credit-hub__tabs { flex-wrap: wrap; overflow: visible; }
  .credit-hub__tab { flex: 1 0 calc(33.333% - var(--hub-space-sm)); min-height: 40px; padding: var(--hub-space-sm) var(--hub-space-xs); text-align: center; }
  .credit-hub__form { grid-template-columns: 1fr; gap: var(--hub-space-sm); }
  .credit-hub__form label:not(.credit-hub__check) { margin-top: var(--hub-space-sm); }
  .credit-hub__kv { grid-template-columns: 110px 1fr; }
}
@container credit-hub (max-width: 380px) { .credit-hub__tab { flex-basis: calc(50% - var(--hub-space-sm)); } }
@media (prefers-reduced-motion: reduce) { .credit-hub *, .credit-hub *::before, .credit-hub *::after { transition: none !important; } }
.credit-hub__notification-center { position: fixed; z-index: 1500; right: 16px; top: 56px; width: min(360px, calc(100vw - 32px)); display: grid; gap: 8px; font: 14px/1.5 sans-serif; color: var(--dsw-alias-label-primary, #202124); }
.credit-hub__notification { padding: 14px; border: 1px solid var(--dsw-alias-border-l3, #e4e7ec); border-radius: 8px; background: var(--dsw-alias-bg-layer-2, #fff); }
.credit-hub__notification p { margin: 6px 0 12px; overflow-wrap: anywhere; }
.credit-hub__notification button { margin-right: 8px; padding: 4px 10px; border: 1px solid var(--dsw-alias-border-l3, #e4e7ec); border-radius: 6px; color: inherit; background: var(--dsw-alias-bg-base, #fff); cursor: pointer; font: inherit; }
`;
