// KM Certo — versão web
// Sem frameworks. Leaflet carrega só quando o mapa é usado.

const $ = (sel) => document.querySelector(sel);

const CHAVES = {
  lojas: 'km.lojas',           // [{ id, nome, endereco, cidade: {nome, uf}, lat, lng }]
  historico: 'km.historico',
  rotas: 'km.rotas',
  geo: 'km.geo',
  cidade: 'km.cidade',         // { nome, uf }
  municipios: 'km.municipios.', // + UF
};

const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB',
  'PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

const ORDEM = ['home', 'mapa', 'opcoes', 'loja', 'remover', 'historico'];
const TELAS_DE_OPCOES = ['loja', 'remover'];

let minhaPos = null;   // { lat, lng, precisao }
let pendente = null;   // { id, nome, endereco, cidade, origem, calc }
let edicaoId = null;   // id da loja em edição na tela de loja
let mapa = null;
let marcador = null;
let leafletPronto = null;

// ---------- utilidades ----------

function ler(chave, padrao) {
  try {
    const v = JSON.parse(localStorage.getItem(chave));
    return v ?? padrao;
  } catch {
    return padrao;
  }
}

function gravar(chave, valor) {
  localStorage.setItem(chave, JSON.stringify(valor));
}

function normalizar(texto) {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function fmtKm(v) {
  return v == null ? '—' : v.toFixed(2).replace('.', ',') + ' km';
}

function fmtR(v) {
  return v == null ? '—' : 'R$ ' + v.toFixed(2).replace('.', ',');
}

function novoId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function esperar(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function mensagem(texto, erro = false, seletor = '#mensagem') {
  const m = $(seletor);
  m.textContent = texto;
  m.classList.toggle('erro', erro);
}

function el(tag, texto, classe) {
  const e = document.createElement(tag);
  e.textContent = texto;
  if (classe) e.className = classe;
  return e;
}

// ---------- cidade e lojas ----------

function cidadeAtual() {
  const c = ler(CHAVES.cidade, null);
  return c && c.nome && c.uf ? c : null;
}

function rotuloCidade(c) {
  return `${c.nome}/${c.uf}`;
}

function todasLojas() {
  return ler(CHAVES.lojas, []);
}

function lojasDaCidade() {
  const c = cidadeAtual();
  if (!c) return [];
  return todasLojas().filter((l) => l.cidade && l.cidade.nome === c.nome && l.cidade.uf === c.uf);
}

function lojasSemCidade() {
  return todasLojas().filter((l) => !l.cidade);
}


function atualizarCidadeHome() {
  const c = cidadeAtual();
  $('#cidade-atual').textContent = c ? `Cidade: ${rotuloCidade(c)}` : 'Cidade: escolha em Opções';
}

// Menu de lojas da Home: só as lojas da cidade escolhida.
function atualizarListaLojas() {
  const sel = $('#loja');
  const anterior = sel.value;
  const lojas = lojasDaCidade();
  sel.innerHTML = '';
  const vazio = !cidadeAtual() ? 'Escolha a cidade em Opções' : 'Nenhuma loja nesta cidade';
  sel.add(new Option(lojas.length ? 'Escolha a loja' : vazio, ''));
  lojas.forEach((l) => sel.add(new Option(l.nome, l.id)));
  sel.add(new Option('+ Adicionar loja', '__nova'));
  if (lojas.some((l) => l.id === anterior)) sel.value = anterior;
}

$('#loja').addEventListener('change', (e) => {
  if (e.target.value !== '__nova') return;
  e.target.value = '';
  if (!cidadeAtual()) {
    navegar('opcoes');
    mensagem('Escolha a cidade antes de cadastrar a loja.', true, '#msg-opcoes');
    return;
  }
  abrirFormLoja(null);
});

// ---------- navegação entre telas ----------

function marcarBotao(nome) {
  let alvo = nome;
  if (nome === 'mapa') alvo = pendente?.origem || 'home';
  if (TELAS_DE_OPCOES.includes(nome)) alvo = 'opcoes';
  document.querySelectorAll('.barra button').forEach((b) => {
    b.classList.toggle('ativo', b.dataset.tela === alvo);
  });
}

function mostrar(nome) {
  const atual = document.querySelector('.tela.ativa');
  const nova = $('#tela-' + nome);
  if (!nova || atual === nova) return;

  const frente = ORDEM.indexOf(nome) >= ORDEM.indexOf(atual.id.slice(5));

  // posiciona a nova tela fora do lugar, sem animar
  nova.classList.add('sem-transicao');
  nova.classList.remove('saindo-esq', 'saindo-dir');
  nova.style.transform = `translateX(${frente ? 24 : -24}px)`;
  nova.style.opacity = '0';
  void nova.offsetWidth;

  // anima a entrada e a saída
  nova.classList.remove('sem-transicao');
  nova.style.transform = '';
  nova.style.opacity = '';
  nova.classList.add('ativa');

  atual.classList.remove('ativa');
  atual.classList.add(frente ? 'saindo-esq' : 'saindo-dir');
  setTimeout(() => atual.classList.remove('saindo-esq', 'saindo-dir'), 250);
}

function navegar(nome) {
  marcarBotao(nome);
  mostrar(nome);
  if (nome === 'home') {
    atualizarCidadeHome();
    atualizarListaLojas();
  }
  if (nome === 'opcoes') renderOpcoes();
  if (nome === 'remover') renderRemover();
  if (nome === 'historico') renderHistorico();
}

document.querySelectorAll('.barra button').forEach((b) => {
  b.addEventListener('click', () => {
    pendente = null;
    edicaoId = null;
    navegar(b.dataset.tela);
  });
});

// ---------- localização (sob demanda) ----------

function obterPosicao() {
  return new Promise((ok, falha) => {
    if (!navigator.geolocation) {
      return falha(new Error('Este aparelho não fornece localização.'));
    }
    navigator.geolocation.getCurrentPosition(
      (p) => ok({
        lat: p.coords.latitude,
        lng: p.coords.longitude,
        precisao: Math.round(p.coords.accuracy),
      }),
      () => falha(new Error('Não consegui obter sua localização. Verifique a permissão.')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  });
}

$('#btn-localizacao').addEventListener('click', async () => {
  try {
    mensagem('Obtendo localização...');
    minhaPos = await obterPosicao();
    $('#estado-local').textContent = `Localização: ok (precisão ~${minhaPos.precisao} m)`;
    mensagem('');
  } catch (e) {
    mensagem(e.message, true);
  }
});

// ---------- busca de endereço e rota ----------

async function buscarEndereco(consulta) {
  const cache = ler(CHAVES.geo, {});
  if (cache[consulta] !== undefined) return cache[consulta];

  const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=' +
    encodeURIComponent(consulta);
  const r = await fetch(url, { headers: { 'Accept-Language': 'pt-BR' } });
  if (!r.ok) throw new Error('Falha na busca de endereço.');

  const j = await r.json();
  const res = j.length ? { lat: +j[0].lat, lng: +j[0].lon, endereco: j[0].display_name } : null;
  cache[consulta] = res;
  gravar(CHAVES.geo, cache);
  return res;
}

function geocodificar(texto, cidade) {
  return buscarEndereco(`${texto}, ${cidade.nome}, ${cidade.uf}, Brasil`);
}

async function distanciaKm(a, b) {
  const chave = [a, b].map((p) => p.lat.toFixed(4) + ',' + p.lng.toFixed(4)).join('|');
  const cache = ler(CHAVES.rotas, {});
  if (cache[chave] != null) return cache[chave];

  const url = `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('Serviço de rotas indisponível.');

  const j = await r.json();
  if (j.code !== 'Ok' || !j.routes?.length) {
    throw new Error('Não encontrei rota pelas ruas entre os pontos.');
  }

  const km = j.routes[0].distance / 1000;
  cache[chave] = km;
  gravar(CHAVES.rotas, cache);
  return km;
}

// ---------- mapa de confirmação ----------

function carregarLeaflet() {
  if (window.L) return Promise.resolve();
  if (!leafletPronto) {
    leafletPronto = new Promise((ok, falha) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(css);

      const js = document.createElement('script');
      js.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      js.onload = ok;
      js.onerror = () => falha(new Error('Não consegui carregar o mapa.'));
      document.head.appendChild(js);
    });
  }
  return leafletPronto;
}

// encontrado: { lat, lng, endereco } ou null
async function abrirMapa(encontrado, p) {
  await carregarLeaflet();

  let centro = encontrado ? [encontrado.lat, encontrado.lng] : null;
  if (!centro) {
    const cid = await buscarEndereco(`${p.cidade.nome}, ${p.cidade.uf}, Brasil`).catch(() => null);
    centro = cid ? [cid.lat, cid.lng] : minhaPos ? [minhaPos.lat, minhaPos.lng] : [0, 0];
  }

  $('#mapa-endereco').textContent = encontrado
    ? `Endereço encontrado: ${encontrado.endereco}`
    : 'Não encontrei o endereço. Toque no mapa no local certo.';

  // espera a transição da tela terminar para o mapa medir o espaço certo
  await esperar(300);

  if (!mapa) {
    mapa = L.map('mapa');
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(mapa);
    mapa.on('click', (e) => {
      if (marcador) marcador.setLatLng(e.latlng);
      else marcador = L.marker(e.latlng, { draggable: true }).addTo(mapa);
    });
  }

  mapa.invalidateSize();
  mapa.setView(centro, encontrado ? 17 : 14, { animate: false });

  if (marcador) marcador.remove();
  marcador = L.marker(centro, { draggable: true }).addTo(mapa);
}

$('#btn-cancelar-mapa').addEventListener('click', () => {
  const origem = pendente?.origem || 'home';
  pendente = null;
  navegar(origem);
});

$('#btn-confirmar-mapa').addEventListener('click', async () => {
  if (!pendente || !marcador) return;

  const pos = marcador.getLatLng();
  const lojas = todasLojas();
  let loja = pendente.id ? lojas.find((l) => l.id === pendente.id) : null;
  if (!loja) {
    loja = { id: novoId() };
    lojas.push(loja);
  }
  Object.assign(loja, {
    nome: pendente.nome,
    endereco: pendente.endereco,
    cidade: pendente.cidade,
    lat: pos.lat,
    lng: pos.lng,
  });
  gravar(CHAVES.lojas, lojas);

  const { origem, calc } = pendente;
  pendente = null;
  navegar(origem);

  if (calc) {
    try {
      await concluir(loja, calc);
    } catch (e) {
      mensagem(e.message, true);
    }
  } else {
    mensagem('Loja salva.', false, '#msg-opcoes');
  }
});

// ---------- cálculo ----------

$('#btn-calcular').addEventListener('click', calcular);

async function calcular() {
  const cidade = cidadeAtual();
  if (!cidade) return mensagem('Escolha a cidade em Opções.', true);

  const lojaId = $('#loja').value;
  const cliente = $('#cliente').value.trim();
  const valor = parseFloat($('#valor').value.replace(',', '.'));

  if (!lojaId || lojaId === '__nova') return mensagem('Escolha a loja no menu.', true);
  if (!cliente) return mensagem('Informe o endereço do cliente.', true);
  if (!(valor > 0)) return mensagem('Informe o valor pago.', true);

  try {
    mensagem('Obtendo sua localização...');
    minhaPos = await obterPosicao();
    $('#estado-local').textContent = `Localização: ok (precisão ~${minhaPos.precisao} m)`;

    const loja = todasLojas().find((l) => l.id === lojaId);
    if (!loja) return mensagem('Loja não encontrada. Escolha de novo.', true);
    await concluir(loja, { cliente, valor });
  } catch (e) {
    mensagem(e.message, true);
  }
}

async function concluir(loja, dados) {
  mensagem('Buscando o endereço do cliente...');
  const cli = await geocodificar(dados.cliente, cidadeAtual() || loja.cidade);
  if (!cli) {
    throw new Error('Não encontrei o endereço do cliente. Inclua o bairro ou a cidade.');
  }

  mensagem('Calculando as rotas...');
  const kmLoja = await distanciaKm(minhaPos, loja);
  const kmCliente = await distanciaKm(loja, cli);
  const total = kmLoja + kmCliente;
  const valorKm = dados.valor / total;

  $('#km-loja').textContent = fmtKm(kmLoja);
  $('#km-cliente').textContent = fmtKm(kmCliente);
  $('#km-total').textContent = fmtKm(total);
  $('#valor-km').textContent = fmtR(valorKm);

  const historico = ler(CHAVES.historico, []);
  historico.push({
    quando: new Date().toISOString(),
    loja: loja.nome,
    cliente: dados.cliente,
    valor: dados.valor,
    kmLoja,
    kmCliente,
    kmTotal: total,
    valorKm,
  });
  gravar(CHAVES.historico, historico);

  mensagem(`Pronto: ${fmtKm(total)} no total, ${fmtR(valorKm)} por km.`);
}

// ---------- opções: cidade ----------

function preencherUFs() {
  const sel = $('#uf');
  if (sel.options.length) return;
  UFS.forEach((uf) => sel.add(new Option(uf, uf)));
}

async function carregarMunicipios(uf) {
  const chave = CHAVES.municipios + uf;
  let lista = ler(chave, null);
  if (!lista) {
    const r = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios?orderBy=nome`);
    if (!r.ok) throw new Error('Não consegui carregar as cidades.');
    lista = (await r.json()).map((m) => m.nome);
    gravar(chave, lista);
  }
  return lista;
}

async function popularCidades(uf, atual) {
  const sel = $('#municipio');
  sel.disabled = true;
  sel.innerHTML = '';
  sel.add(new Option('Carregando...', ''));
  try {
    const lista = await carregarMunicipios(uf);
    sel.innerHTML = '';
    sel.add(new Option('Escolha a cidade', ''));
    lista.forEach((n) => sel.add(new Option(n, n)));
    sel.disabled = false;
    if (atual && atual.uf === uf) sel.value = atual.nome;
  } catch (e) {
    sel.innerHTML = '';
    sel.add(new Option('Sem conexão', ''));
    mensagem(e.message, true, '#msg-opcoes');
  }
}

$('#uf').addEventListener('change', (e) => {
  popularCidades(e.target.value, null);
});

$('#municipio').addEventListener('change', (e) => {
  const nome = e.target.value;
  if (!nome) return;
  gravar(CHAVES.cidade, { nome, uf: $('#uf').value });
  mensagem(`Cidade escolhida: ${nome}/${$('#uf').value}.`, false, '#msg-opcoes');
  atualizarCidadeHome();
  atualizarTituloCidade();
  listarLojas();
});

function atualizarTituloCidade() {
  const c = cidadeAtual();
  $('#titulo-cidade').textContent = c ? rotuloCidade(c) : 'nenhuma cidade escolhida';
}

// ---------- opções: lojas ----------

function renderOpcoes() {
  preencherUFs();
  const c = cidadeAtual();
  $('#uf').value = c ? c.uf : $('#uf').value;
  popularCidades($('#uf').value, c);
  atualizarTituloCidade();
  listarLojas();
}

function itemLoja(l) {
  const li = document.createElement('li');
  const texto = document.createElement('div');
  texto.appendChild(el('div', l.nome));
  if (l.endereco) texto.appendChild(el('small', l.endereco));
  const btn = el('button', 'editar');
  btn.addEventListener('click', () => abrirFormLoja(l));
  li.append(texto, btn);
  return li;
}

function listarLojas() {
  const ul = $('#lista-lojas');
  ul.innerHTML = '';
  const lojas = lojasDaCidade();
  if (!lojas.length) ul.appendChild(el('li', 'Nenhuma loja nesta cidade.'));
  lojas.forEach((l) => ul.appendChild(itemLoja(l)));

  const semCidade = lojasSemCidade();
  $('#bloco-sem-cidade').hidden = !semCidade.length;
  const ul2 = $('#lista-sem-cidade');
  ul2.innerHTML = '';
  semCidade.forEach((l) => ul2.appendChild(itemLoja(l)));
}

function abrirFormLoja(loja) {
  edicaoId = loja ? loja.id : null;
  $('#titulo-form').textContent = loja ? 'Editar loja' : 'Nova loja';
  $('#loja-nome-form').value = loja ? loja.nome : '';
  $('#loja-endereco-form').value = loja ? loja.endereco || '' : '';
  navegar('loja');
}

$('#btn-adicionar').addEventListener('click', () => abrirFormLoja(null));

$('#btn-voltar-loja').addEventListener('click', () => {
  edicaoId = null;
  navegar('opcoes');
});

$('#btn-salvar-loja').addEventListener('click', async () => {
  const nome = $('#loja-nome-form').value.trim();
  const endereco = $('#loja-endereco-form').value.trim();
  if (!nome) return mensagem('Informe o nome da loja.', true, '#msg-opcoes');

  const existente = edicaoId ? todasLojas().find((l) => l.id === edicaoId) : null;
  const cidade = existente?.cidade || cidadeAtual();
  if (!cidade) return mensagem('Escolha a cidade antes de cadastrar a loja.', true, '#msg-opcoes');

  mensagem('Buscando no mapa...', false, '#msg-opcoes');
  try {
    const g = await geocodificar(endereco || nome, cidade).catch(() => null);
    pendente = {
      id: existente ? existente.id : null,
      nome,
      endereco,
      cidade,
      origem: 'opcoes',
      calc: null,
    };
    edicaoId = null;
    navegar('mapa');
    await abrirMapa(g, pendente);
  } catch (e) {
    mensagem(e.message, true, '#msg-opcoes');
  }
});

// ---------- opções: remover lojas ----------

function renderRemover() {
  const ul = $('#lista-remover');
  ul.innerHTML = '';
  const lojas = todasLojas();
  if (!lojas.length) {
    ul.appendChild(el('li', 'Nenhuma loja cadastrada.'));
    return;
  }
  lojas.forEach((l) => {
    const li = document.createElement('li');
    const label = document.createElement('label');
    label.className = 'marcar';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = l.id;
    const sufixo = l.cidade ? ` — ${rotuloCidade(l.cidade)}` : ' — sem cidade';
    label.append(cb, `${l.nome}${sufixo}`);
    li.appendChild(label);
    ul.appendChild(li);
  });
}

$('#btn-remover').addEventListener('click', () => navegar('remover'));

$('#btn-voltar-remover').addEventListener('click', () => navegar('opcoes'));

$('#btn-confirmar-remover').addEventListener('click', () => {
  const ids = [...document.querySelectorAll('#lista-remover input:checked')].map((i) => i.value);
  if (ids.length) {
    gravar(CHAVES.lojas, todasLojas().filter((l) => !ids.includes(l.id)));
  }
  navegar('opcoes');
  mensagem(ids.length ? `${ids.length} loja(s) removida(s).` : 'Nenhuma loja removida.', false, '#msg-opcoes');
});

$('#btn-limpar-historico').addEventListener('click', () => {
  if (!confirm('Apagar todo o histórico?')) return;
  localStorage.removeItem(CHAVES.historico);
  mensagem('Histórico apagado.', false, '#msg-opcoes');
});

// ---------- histórico ----------

function renderHistorico() {
  const ul = $('#lista-historico');
  ul.innerHTML = '';
  const h = ler(CHAVES.historico, []);
  if (!h.length) {
    ul.appendChild(el('li', 'Nenhuma consulta ainda.'));
    return;
  }
  h.slice().reverse().forEach((c) => {
    const data = new Date(c.quando).toLocaleString('pt-BR');
    const li = document.createElement('li');
    const texto = document.createElement('div');
    texto.appendChild(el('div', `${c.loja} → ${c.cliente}`));
    texto.appendChild(el('small', `${data} · ${fmtKm(c.kmTotal)} · ${fmtR(c.valorKm)}/km`));
    li.appendChild(texto);
    ul.appendChild(li);
  });
}

// ---------- início ----------

(function iniciar() {
  // lojas salvas por versões anteriores não tinham id
  const lojas = todasLojas();
  if (lojas.some((l) => !l.id)) {
    lojas.forEach((l) => { if (!l.id) l.id = novoId(); });
    gravar(CHAVES.lojas, lojas);
  }
  atualizarCidadeHome();
  atualizarListaLojas();
})();
