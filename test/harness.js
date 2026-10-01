// Minimal DOM and storage stubs so index.html's script can be loaded in Node
// and its logic exercised without a browser.
const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};
function el() {
  const e = {
    _h: '', _t: '', hidden: false, value: '', placeholder: '', className: '', scrollTop: 0,
    dataset: {}, style: {},
    setAttribute(){}, getAttribute(){ return null; }, addEventListener(){},
    scrollIntoView(){}, focus(){}, closest(){ return null; },
    querySelectorAll(){ return []; },
    get innerHTML(){ return this._h; }, set innerHTML(v){ this._h = String(v); },
    get textContent(){ return this._t; }, set textContent(v){ this._t = String(v); }
  };
  return e;
}
const nodes = {};
global.document = {
  getElementById(id){ return nodes[id] || (nodes[id] = el()); },
  querySelectorAll(){ return []; },
  addEventListener(){}, hidden: false
};
global.window = { addEventListener(){} };
global.navigator = {};
global.fetch = () => Promise.reject(new Error('no network in tests'));
global.btoa = s => Buffer.from(s, 'binary').toString('base64');
global.atob = s => Buffer.from(s, 'base64').toString('binary');
global.__nodes = nodes;
