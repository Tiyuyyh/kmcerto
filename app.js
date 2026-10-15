// KM Certo — versão web
// Sem frameworks. Leaflet carrega só quando o mapa é usado.

const $ = (sel) => document.querySelector(sel);

const CHAVES = {
  lojas: 'km.lojas',
  historico: 'km.historico',
  rotas: 'km.rotas',
  geo: 'km.geo',
  cidade: 'km.cidade',
};

const ORDEM = ['home', 'mapa', 'opcoes', 'historico'];

let minhaPos = null;   // { lat, lng, precisao }
let pendente = null;   // dados de uma corrida esperando confirmação da loja no mapa
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

function mensagem(texto, erro = false) {
  const m = $('#mensagem');
  m.textContent = texto;
  m.classList.toggle('erro', erro);
}

function el(tag, texto, classe) {
  const e = document.createElement(tag);
  e.textContent = texto;
  if (classe) e.className = classe;
  return e;
}

// ---------- navegação entre telas ----------

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

function marcarBotao(nome) {
  document.querySelectorAll('.barra button').forEach((b) => {
    b.classList.toggle('ativo', b.dataset.tela === nome);
  });
}

document.querySelectorAll('.barra button').forEach((b) => {
  b.addEventListener('click', () => {
    const nome = b.dataset.tela;
    if (pendente && nome === 'home') pendente = null;
    marcarBotao(nome);
    mostrar(nome);
    if (nome === 'opcoes') renderOpcoes();
    if (nome === 'historico') renderHistorico();
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

// ---------- lojas cadastradas ----------

function achaLoja(nome) {
  const alvo = normalizar(nome);
  const lojas = ler(CHAVES.lojas, []);
  return (
    lojas.find((l) => normalizar(l.nome) === alvo) ||
    lojas.find((l) => normalizar(l.nome).includes(alvo) || alvo.includes(normalizar(l.nome))) ||
    null
  );
}

function atualizarListaLojas() {
  const dl = $('#lojas-lista');
  dl.innerHTML = '';
  ler(CHAVES.lojas, []).forEach((l) => {
    const o = document.createElement('option');
    o.value = l.nome;
    dl.appendChild(o);
  });
}

// ---------- busca de endereço e rota ----------

async function geocodificar(texto) {
  const cidade = ler(CHAVES.cidade, '');
  const consulta = cidade ? `${texto}, ${cidade}` : texto;

  const cache = ler(CHAVES.geo, {});
  if (cache[consulta]) return cache[consulta];

  const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=' +
    encodeURIComponent(consulta);
  const r = await fetch(url, { headers: { 'Accept-Language': 'pt-BR' } });
  if (!r.ok) throw new Error('Falha na busca de endereço.');

  const j = await r.json();
  if (!j.length) return null;

  const res = { lat: +j[0].lat, lng: +j[0].lon, endereco: j[0].display_name };
  cache[consulta] = res;
  gravar(CHAVES.geo, cache);
  return res;
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

async function abrirMapa(p) {
  await carregarLeaflet();
  const centro = p.lat != null ? [p.lat, p.lng] : [minhaPos.lat, minhaPos.lng];

  if (!mapa) {
    mapa = L.map('mapa');
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(mapa);
  }

  mapa.setView(centro, 17);
  if (marcador) marcador.remove();
  marcador = L.marker(centro, { draggable: true }).addTo(mapa);
  setTimeout(() => mapa.invalidateSize(), 250);
}

$('#btn-cancelar-mapa').addEventListener('click', () => {
  pendente = null;
  marcarBotao('home');
  mostrar('home');
  mensagem('');
});

$('#btn-confirmar-mapa').addEventListener('click', async () => {
  if (!pendente || !marcador) return;

  const pos = marcador.getLatLng();
  const loja = {
    nome: pendente.nome,
    lat: pos.lat,
    lng: pos.lng,
    endereco: pendente.endereco || '',
  };

  const lojas = ler(CHAVES.lojas, []);
  lojas.push(loja);
  gravar(CHAVES.lojas, lojas);
  atualizarListaLojas();

  const dados = { nome: pendente.nome, cliente: pendente.cliente, valor: pendente.valor };
  pendente = null;
  marcarBotao('home');
  mostrar('home');

  try {
    await concluir(loja, dados);
  } catch (e) {
    mensagem(e.message, true);
  }
});

// ---------- cálculo ----------

$('#btn-calcular').addEventListener('click', calcular);

async function calcular() {
  const nome = $('#loja').value.trim();
  const cliente = $('#cliente').value.trim();
  const valor = parseFloat($('#valor').value.replace(',', '.'));

  if (!nome) return mensagem('Informe o nome da loja.', true);
  if (!cliente) return mensagem('Informe o endereço do cliente.', true);
  if (!(valor > 0)) return mensagem('Informe o valor pago.', true);

  try {
    mensagem('Obtendo sua localização...');
    minhaPos = await obterPosicao();
    $('#estado-local').textContent = `Localização: ok (precisão ~${minhaPos.precisao} m)`;

    const loja = achaLoja(nome);
    if (loja) {
      await concluir(loja, { nome, cliente, valor });
      return;
    }

    // loja nova: busca o endereço e pede confirmação no mapa
    mensagem('Buscando a loja...');
    const g = await geocodificar(nome).catch(() => null);
    pendente = {
      nome,
      cliente,
      valor,
      lat: g ? g.lat : null,
      lng: g ? g.lng : null,
      endereco: g ? g.endereco : '',
    };
    marcarBotao('mapa');
    mostrar('mapa');
    await abrirMapa(pendente);
    mensagem('Confirme o ponto da loja no mapa.');
  } catch (e) {
    mensagem(e.message, true);
  }
}

async function concluir(loja, dados) {
  mensagem('Buscando o endereço do cliente...');
  const cli = await geocodificar(dados.cliente);
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

// ---------- opções ----------

function renderOpcoes() {
  $('#cidade-padrao').value = ler(CHAVES.cidade, '');

  const ul = $('#lista-lojas');
  ul.innerHTML = '';
  const lojas = ler(CHAVES.lojas, []);
  if (!lojas.length) {
    ul.appendChild(el('li', 'Nenhuma loja cadastrada ainda.'));
    return;
  }
  lojas.forEach((l, i) => {
    const li = el('li', l.nome);
    const btn = el('button', 'remover');
    btn.addEventListener('click', () => {
      const atual = ler(CHAVES.lojas, []);
      atual.splice(i, 1);
      gravar(CHAVES.lojas, atual);
      atualizarListaLojas();
      renderOpcoes();
    });
    li.appendChild(btn);
    ul.appendChild(li);
  });
}

$('#btn-salvar-cidade').addEventListener('click', () => {
  gravar(CHAVES.cidade, $('#cidade-padrao').value.trim());
  mensagem('Cidade salva.');
});

$('#btn-limpar-historico').addEventListener('click', () => {
  if (!confirm('Apagar todo o histórico?')) return;
  localStorage.removeItem(CHAVES.historico);
  renderHistorico();
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
    texto.appendChild(el('div', `${data} · ${fmtKm(c.kmTotal)} · ${fmtR(c.valorKm)}/km`));
    li.appendChild(texto);
    ul.appendChild(li);
  });
}

// ---------- início ----------

atualizarListaLojas();
