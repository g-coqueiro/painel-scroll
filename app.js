'use strict';

// Todo parâmetro ajustável vive aqui. Nada de valor solto no meio da lógica.
const CONFIG = {
    // --- Dashboard ---

    // Dashboard espelhado.
    dashboardUrl: 'https://whitebox.isso.digital/UwiGFDAXcl5v/',

    // Duração de cada sentido do scroll (descida e subida).
    scrollDurationMs: 250000,

    // Pausa no topo e no fim, para o conteúdo ficar legível na virada.
    pauseMs: 3000,

    // Recarrega o iframe ao fim de cada ciclo completo (desce + sobe).
    reloadOnCycleEnd: true,

    // Acrescenta ?_=timestamp na URL do dashboard para furar cache.
    cacheBuster: true,

    // Usado SÓ no modo de fallback (cross-origin), quando não dá para ler a
    // altura real do documento. Medir com document.documentElement.scrollHeight
    // no console do dashboard, EM 1920x1080 (o layout é responsivo: medir em
    // outra largura dá outro valor). Última medição: 9399px em 2026-09-14.
    fallbackHeightPx: 9399,

    // CSS injetado dentro do dashboard (só funciona no modo same-origin).
    // Ex.: 'header { display: none !important; }'
    innerCss: '',

    // --- Slideshow ---

    slideshowEnabled: true,

    // Gerado pelo scripts/sync-images.sh no próprio RPi.
    manifestUrl: 'images/manifest.json',
    imagesBaseUrl: 'images/',

    imageDurationMs: 10000,
    imageFadeMs: 600,

    // Sem esses limites, um manifest ou uma imagem que nunca respondem
    // deixariam a TV parada no slideshow para sempre.
    manifestTimeoutMs: 5000,
    imageTimeoutMs: 15000,

    // --- Robustez ---

    // De quanto em quanto tempo reconferir a altura do dashboard.
    remeasureIntervalMs: 1000,

    // Watchdog: se nenhum quadro avançar por esse tempo, recarrega na marra.
    stuckTimeoutMs: 10 * 60 * 1000,

    // Recarrega a própria página 1x/dia, e só se ela estiver acessível.
    appReloadMs: 24 * 60 * 60 * 1000,

    // Intervalo do watchdog (setInterval sobrevive ao rAF congelado).
    watchdogIntervalMs: 30000,

    // --- Diagnóstico ---

    // Mostra por alguns segundos, no canto da tela, em qual modo a página
    // entrou e qual altura ela está enxergando. Só na primeira carga (a página
    // recarrega 1x/dia), então não polui a TV. 0 desliga.
    debugBadgeMs: 20000
};

const frame = document.getElementById('frame');
const slideshow = document.getElementById('slideshow');
const slide = document.getElementById('slide');
const badge = document.getElementById('badge');

let mode = 'fixo';         // 'medido' = altura lida do dashboard | 'fixo' = fallback
let phase = 'loading';     // loading | pause | scroll | slideshow
let direction = 1;         // 1 = descendo, -1 = subindo
let phaseStart = null;     // timestamp do rAF em que a fase começou
let slideshowAtivo = false;
let iframeCarregando = false;
let badgeJaMostrado = false;
let alturaAplicada = 0;
let ultimaMedida = 0;
let lastTick = Date.now();
let nextAppReload = Date.now() + CONFIG.appReloadMs;

document.documentElement.style.setProperty('--fade-ms', CONFIG.imageFadeMs + 'ms');

function esperar(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

// ---------------------------------------------------------------- dashboard

function dashboardSrc() {
    const url = CONFIG.dashboardUrl;
    if (!CONFIG.cacheBuster) return url;
    return url + (url.indexOf('?') === -1 ? '?' : '&') + '_=' + Date.now();
}

// Verifica se a same-origin policy está desativada (flag do kiosk). Sem a flag,
// contentDocument vem null ou lança SecurityError: caímos no modo de altura
// fixa e o painel continua funcionando.
function innerDocument() {
    try {
        const doc = frame.contentDocument;
        if (!doc || !doc.documentElement) return null;
        if (doc.location && doc.location.href === 'about:blank') return null;
        return doc;
    } catch (e) {
        return null;
    }
}

// O iframe é SEMPRE alto o bastante para caber o dashboard inteiro, e o scroll
// é sempre translateY. A permissão do kiosk serve só para descobrir o número
// certo. Encolher o iframe para 100vh e rolar por dentro (como a versão
// anterior fazia) muda o jeito que o whitebox se desenha — ver §5.2 do CLAUDE.md.
function alturaConteudo() {
    if (mode === 'medido') {
        const doc = innerDocument();
        if (doc) {
            const medida = Math.max(
                doc.documentElement.scrollHeight,
                doc.body ? doc.body.scrollHeight : 0
            );
            // Medida menor que a tela = dashboard ainda desenhando. Aceitar isso
            // deixaria o painel sem nada para rolar.
            if (medida > window.innerHeight) return medida;
        }
    }
    return CONFIG.fallbackHeightPx;
}

// Aplica a altura no elemento, só quando o número muda (escrever em style
// força reflow, e o dashboard é grande).
function ajustarAltura() {
    const altura = alturaConteudo();
    if (altura === alturaAplicada) return;
    alturaAplicada = altura;
    frame.style.height = altura + 'px';
}

function maxScroll() {
    return Math.max(0, alturaConteudo() - window.innerHeight);
}

function applyScroll(y) {
    frame.style.transform = 'translateY(' + (-y) + 'px)';
}

function injectInnerCss(doc) {
    if (!CONFIG.innerCss) return;
    try {
        const style = doc.createElement('style');
        style.textContent = CONFIG.innerCss;
        doc.head.appendChild(style);
    } catch (e) {
        /* dashboard ainda protegido: segue sem o CSS */
    }
}

// Selo de diagnóstico: a flag do Chromium pode estar ativa e a página ainda
// assim cair no fallback. O único jeito de ver isso na TV é a própria página
// dizer em que modo entrou, e qual altura está medindo.
function textoBadge() {
    return mode === 'medido'
        ? 'altura automática · ' + Math.round(alturaConteudo()) + 'px medidos no dashboard'
        : 'altura fixa · ' + CONFIG.fallbackHeightPx + 'px (sem permissão para medir)';
}

function mostrarBadge() {
    if (!CONFIG.debugBadgeMs || badgeJaMostrado) return;
    badgeJaMostrado = true;

    badge.textContent = textoBadge();
    badge.hidden = false;
    void badge.offsetWidth; // força o reflow para a transição valer
    badge.classList.add('visivel');

    // O dashboard ainda está desenhando os gráficos: o número cresce nos
    // primeiros segundos até assentar.
    const atualiza = setInterval(function () { badge.textContent = textoBadge(); }, 1000);

    setTimeout(function () {
        clearInterval(atualiza);
        badge.classList.remove('visivel');
        setTimeout(function () { badge.hidden = true; }, CONFIG.imageFadeMs);
    }, CONFIG.debugBadgeMs);
}

function recarregarDashboard() {
    iframeCarregando = true;
    if (!slideshowAtivo) phase = 'loading';
    lastTick = Date.now();
    frame.src = dashboardSrc();
}

// Cada carga do iframe redefine o modo: se a flag do Chromium sumir numa
// atualização, o painel se ajusta sozinho no ciclo seguinte.
frame.addEventListener('load', function () {
    iframeCarregando = false;
    const doc = innerDocument();
    mode = doc ? 'medido' : 'fixo';
    if (doc) injectInnerCss(doc);

    alturaAplicada = 0; // força reaplicar: o conteúdo é outro
    ajustarAltura();
    frame.style.transform = 'translateY(0px)';

    lastTick = Date.now();
    mostrarBadge();

    // Durante o slideshow o dashboard recarrega escondido atrás do overlay.
    // Quem retoma o scroll é o fim do slideshow, não este handler.
    if (slideshowAtivo) return;

    direction = 1;
    phase = 'pause';
    phaseStart = null;
});

// ---------------------------------------------------------------- slideshow

// Lê o manifest gerado pelo sync. Qualquer falha devolve lista vazia: o painel
// pula o slideshow em silêncio e volta para o dashboard.
async function carregarManifest() {
    if (!CONFIG.slideshowEnabled) return [];

    const abort = new AbortController();
    const timer = setTimeout(function () { abort.abort(); }, CONFIG.manifestTimeoutMs);

    try {
        const resposta = await fetch(CONFIG.manifestUrl, {
            cache: 'no-store',
            signal: abort.signal
        });
        if (!resposta.ok) return [];

        const dados = await resposta.json();
        const lista = Array.isArray(dados) ? dados : (dados && dados.images) || [];

        return lista
            .map(function (item) {
                return typeof item === 'string' ? item : (item && item.name);
            })
            .filter(function (nome) {
                return typeof nome === 'string' && nome.length > 0;
            });
    } catch (e) {
        return [];
    } finally {
        clearTimeout(timer);
    }
}

// Baixa a imagem antes de exibir: sem isso, a troca mostraria um quadro em
// branco enquanto o arquivo carrega. Devolve false se a imagem não veio.
function preCarregar(url) {
    return new Promise(function (resolve) {
        const img = new Image();
        const timer = setTimeout(function () { resolve(false); }, CONFIG.imageTimeoutMs);

        img.onload = function () { clearTimeout(timer); resolve(true); };
        img.onerror = function () { clearTimeout(timer); resolve(false); };
        img.src = url;
    });
}

async function rodarSlideshow() {
    // O manifest é lido com o dashboard ainda parado no topo. Recarregar antes
    // disso deixaria o iframe piscando em branco na frente de todo mundo
    // enquanto o fetch não responde (até manifestTimeoutMs).
    const imagens = await carregarManifest();

    if (!imagens.length) {
        if (CONFIG.reloadOnCycleEnd) recarregarDashboard();
        return;
    }

    slideshow.classList.add('visivel');
    slideshow.setAttribute('aria-hidden', 'false');
    await esperar(CONFIG.imageFadeMs);

    // Só agora, com o overlay cobrindo a tela, o dashboard recarrega: quando o
    // slideshow terminar ele já estará pronto, sem iframe em branco à vista.
    if (CONFIG.reloadOnCycleEnd) recarregarDashboard();

    for (const nome of imagens) {
        const url = CONFIG.imagesBaseUrl + encodeURIComponent(nome);
        if (!await preCarregar(url)) continue;

        slide.src = url;
        slide.classList.add('visivel');
        await esperar(CONFIG.imageDurationMs);
        slide.classList.remove('visivel');
        await esperar(CONFIG.imageFadeMs);

        // O slideshow pode durar mais que o watchdog se houver muitas imagens.
        lastTick = Date.now();
    }

    slideshow.classList.remove('visivel');
    slideshow.setAttribute('aria-hidden', 'true');
    await esperar(CONFIG.imageFadeMs);
    slide.removeAttribute('src');
}

function retomarScroll() {
    slideshowAtivo = false;
    direction = 1;
    lastTick = Date.now();

    // Se o dashboard ainda não terminou de recarregar, quem retoma é o
    // handler de 'load'. Voltar a rolar agora exibiria conteúdo pela metade.
    if (iframeCarregando) {
        phase = 'loading';
        return;
    }

    applyScroll(0);
    phase = 'pause';
    phaseStart = null;
}

// ------------------------------------------------------------------- ciclo

function fimDoCiclo() {
    if (!CONFIG.slideshowEnabled) {
        if (CONFIG.reloadOnCycleEnd) {
            recarregarDashboard();
        } else {
            direction = 1;
            phase = 'pause';
            phaseStart = null;
        }
        return;
    }

    // Quem dispara o reload do dashboard é o slideshow, depois que o overlay
    // cobre a tela (ou na hora, se não houver imagem nenhuma para exibir).
    phase = 'slideshow';
    slideshowAtivo = true;

    rodarSlideshow()
        .catch(function () { /* nunca deixa o painel preso no slideshow */ })
        .then(retomarScroll);
}

function animate(timestamp) {
    requestAnimationFrame(animate);

    if (phase === 'loading' || phase === 'slideshow') return;
    if (phaseStart === null) phaseStart = timestamp;

    lastTick = Date.now();
    const elapsed = timestamp - phaseStart;

    if (phase === 'pause') {
        if (elapsed >= CONFIG.pauseMs) {
            phase = 'scroll';
            phaseStart = timestamp;
        }
        return;
    }

    // O dashboard pode crescer durante o ciclo (gráfico novo, tabela que
    // termina de carregar). Remedir a cada quadro seria caro; 1x por segundo
    // basta para um scroll de 250 s.
    if (timestamp - ultimaMedida >= CONFIG.remeasureIntervalMs) {
        ultimaMedida = timestamp;
        ajustarAltura();
    }

    const limite = maxScroll();
    const progress = Math.min(elapsed / CONFIG.scrollDurationMs, 1);
    applyScroll(direction === 1 ? progress * limite : (1 - progress) * limite);

    if (progress < 1) return;

    if (direction === 1) {
        direction = -1;
        phase = 'pause';
        phaseStart = timestamp;
        return;
    }

    fimDoCiclo();
}

// --------------------------------------------------------------- robustez

// Reload da própria página só depois de confirmar que ela responde. Sem essa
// checagem, um reload durante queda de rede deixaria a TV parada na tela de
// erro do navegador até alguém ir até lá.
function reloadAppSeGuro() {
    if (navigator.onLine === false) return;
    fetch(location.href, { cache: 'no-store' })
        .then(function (r) { if (r.ok) location.reload(); })
        .catch(function () { /* rede fora: tenta no próximo tick */ });
}

// Watchdog: o rAF congela com a tela apagada ou a aba oculta, e o iframe pode
// nunca disparar 'load' se a rede cair no meio da carga. setInterval também é
// estrangulado em segundo plano, mas continua disparando de tempos em tempos.
setInterval(function () {
    if (Date.now() - lastTick >= CONFIG.stuckTimeoutMs) recarregarDashboard();

    if (Date.now() >= nextAppReload) {
        nextAppReload = Date.now() + CONFIG.appReloadMs;
        reloadAppSeGuro();
    }
}, CONFIG.watchdogIntervalMs);

document.addEventListener('visibilitychange', function () {
    if (!document.hidden) lastTick = Date.now();
});

// A altura precisa estar aplicada ANTES do dashboard carregar: se ele carregar
// dentro de um iframe curto, se desenha errado.
ajustarAltura();
recarregarDashboard();
requestAnimationFrame(animate);
