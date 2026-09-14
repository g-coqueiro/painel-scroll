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

    // --- Slides ---

    // Páginas HTML exibidas entre um ciclo de scroll e outro, nesta ordem.
    // Lista vazia = sem slides; o painel só rola o dashboard.
    slides: [
        { src: 'slides/kaizen-spda-g09-g10.html', durationMs: 45000 },
        { src: 'slides/kaizen-portoes-g09-g11.html', durationMs: 45000 }
    ],

    slideDefaultDurationMs: 45000,

    // Resolução em que os slides são desenhados. Eles são escalados para caber
    // na janela: com o zoom de 150% do kiosk (§4.2 do CLAUDE.md) o viewport é
    // 1280x720, e sem a escala um slide de 1920px apareceria cortado.
    slideBaseWidth: 1920,
    slideBaseHeight: 1080,

    fadeMs: 600,

    // Slide que não carrega nesse tempo é pulado, para não prender a TV.
    slideTimeoutMs: 15000,

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

    // Manda os mesmos números do selo para o servidor local, que os registra
    // em ~/http.log no RPi. Assim dá para diagnosticar por SSH, sem alguém
    // precisar ler o selo na TV. A requisição dá 404 de propósito.
    diagPing: true,
    diagPingDelayMs: 45000,

    // Selo na tela com o modo e a altura. Desligado: serviu para validar a
    // instalação e não faz sentido aparecer para quem passa na frente da TV.
    // Pôr 20000 quando precisar diagnosticar olhando o painel.
    debugBadgeMs: 0
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
let badgeJaReportado = false;
let alturaAplicada = 0;
let ultimaMedida = 0;
let lastTick = Date.now();
let nextAppReload = Date.now() + CONFIG.appReloadMs;

document.documentElement.style.setProperty('--fade-ms', CONFIG.fadeMs + 'ms');

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
// anterior fazia) muda o jeito que o whitebox se desenha — ver §4.2 do CLAUDE.md.

// Medida crua, sem rede de segurança. 0 = não deu para ler.
function alturaMedida() {
    const doc = innerDocument();
    if (!doc) return 0;
    return Math.max(
        doc.documentElement.scrollHeight,
        doc.body ? doc.body.scrollHeight : 0
    );
}

function alturaConteudo() {
    // Medida menor que a tela = dashboard ainda desenhando. Aceitar isso
    // deixaria o painel sem nada para rolar.
    const medida = alturaMedida();
    if (medida > window.innerHeight) return medida;
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
    const caixa = frame.getBoundingClientRect();
    const partes = [
        'janela ' + window.innerWidth + '×' + window.innerHeight,
        'zoom ' + (window.devicePixelRatio || 1),
        'iframe ' + Math.round(caixa.width) + '×' + Math.round(caixa.height)
    ];

    const doc = innerDocument();
    if (doc) {
        partes.push('dashboard ' + doc.documentElement.clientWidth +
                    '×' + Math.round(alturaMedida()) + ' (medido)');
    } else {
        partes.push('altura fixa ' + CONFIG.fallbackHeightPx + ' (sem permissão)');
    }

    return partes.join(' · ');
}

function reportarDiagnostico(rotulo) {
    if (!CONFIG.diagPing) return;
    const doc = innerDocument();
    const dados = [
        rotulo,
        'janela-' + window.innerWidth + 'x' + window.innerHeight,
        'zoom-' + (window.devicePixelRatio || 1),
        'modo-' + mode,
        // medida = o que foi lido no dashboard (0 = nao leu); altura = o que o
        // painel esta usando. Diferentes significa que caiu no fallback.
        'medida-' + Math.round(alturaMedida()),
        'altura-' + Math.round(alturaConteudo()),
        'dashboard-' + (doc ? doc.documentElement.clientWidth : 'ilegivel')
    ].join('__');

    fetch('/__diag/' + dados, { cache: 'no-store' }).catch(function () { /* ignora */ });
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
        setTimeout(function () { badge.hidden = true; }, CONFIG.fadeMs);
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
    if (!badgeJaReportado) {
        badgeJaReportado = true;
        // Dois retratos: no load os graficos ainda estao desenhando e a medida
        // sai baixa; o segundo pega o numero ja assentado.
        reportarDiagnostico('carregou');
        setTimeout(function () { reportarDiagnostico('assentado'); }, CONFIG.diagPingDelayMs);
    }

    // Durante os slides o dashboard recarrega escondido atrás do overlay.
    // Quem retoma o scroll é o fim da sequência, não este handler.
    if (slideshowAtivo) return;

    direction = 1;
    phase = 'pause';
    phaseStart = null;
});

// ------------------------------------------------------------------ slides

// O iframe dispara 'load' tambem para uma pagina de erro, entao um slide que
// nao existe apareceria como o 404 do servidor na TV. Conferir antes.
async function slideExiste(src) {
    try {
        const resposta = await fetch(src, { method: 'HEAD', cache: 'no-store' });
        return resposta.ok;
    } catch (e) {
        return false;
    }
}

// Carrega com o slide ainda invisível: a troca entre um e outro não pode
// mostrar quadro em branco. Devolve false se demorar demais.
function carregarSlide(src) {
    return new Promise(function (resolve) {
        let respondido = false;

        function terminar(ok) {
            if (respondido) return;
            respondido = true;
            clearTimeout(timer);
            slide.removeEventListener('load', aoCarregar);
            resolve(ok);
        }

        function aoCarregar() { terminar(true); }

        const timer = setTimeout(function () { terminar(false); }, CONFIG.slideTimeoutMs);
        slide.addEventListener('load', aoCarregar);
        slide.src = src;
    });
}

// Os slides têm layout fixo em slideBaseWidth x slideBaseHeight. O iframe é
// mantido nesse tamanho (para o layout de dentro ficar correto) e encolhido
// visualmente por transform, o que funciona em qualquer zoom ou resolução.
function ajustarEscalaSlide() {
    const escala = Math.min(
        window.innerWidth / CONFIG.slideBaseWidth,
        window.innerHeight / CONFIG.slideBaseHeight
    );
    slide.style.width = CONFIG.slideBaseWidth + 'px';
    slide.style.height = CONFIG.slideBaseHeight + 'px';
    slide.style.transform = 'scale(' + escala + ')';
}

async function rodarSlides() {
    const lista = (CONFIG.slides || []).filter(function (s) { return s && s.src; });
    let overlayAberto = false;

    for (const item of lista) {
        if (!await slideExiste(item.src)) continue;
        if (!await carregarSlide(item.src)) continue;

        if (!overlayAberto) {
            overlayAberto = true;
            ajustarEscalaSlide();
            slideshow.classList.add('visivel');
            slideshow.setAttribute('aria-hidden', 'false');
            await esperar(CONFIG.fadeMs);

            // Só agora, com a tela coberta, o dashboard recarrega: quando os
            // slides terminarem ele já estará pronto, sem iframe em branco.
            if (CONFIG.reloadOnCycleEnd) recarregarDashboard();
        }

        slide.classList.add('visivel');
        await esperar(item.durationMs || CONFIG.slideDefaultDurationMs);
        slide.classList.remove('visivel');
        await esperar(CONFIG.fadeMs);

        // A sequência pode durar mais que o watchdog se houver muitos slides.
        lastTick = Date.now();
    }

    // Nenhum slide carregou: o dashboard ainda não foi recarregado.
    if (!overlayAberto) {
        if (CONFIG.reloadOnCycleEnd) recarregarDashboard();
        return;
    }

    slideshow.classList.remove('visivel');
    slideshow.setAttribute('aria-hidden', 'true');
    await esperar(CONFIG.fadeMs);
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
    if (!(CONFIG.slides || []).length) {
        if (CONFIG.reloadOnCycleEnd) {
            recarregarDashboard();
        } else {
            direction = 1;
            phase = 'pause';
            phaseStart = null;
        }
        return;
    }

    // Quem dispara o reload do dashboard é a sequência de slides, depois que o
    // overlay cobre a tela (ou na hora, se nenhum slide puder ser exibido).
    phase = 'slideshow';
    slideshowAtivo = true;

    rodarSlides()
        .catch(function () { /* nunca deixa o painel preso nos slides */ })
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

// A TV não muda de tamanho, mas o zoom do Chromium sim — e ele altera o
// viewport em px CSS, que é o que a escala do slide usa.
window.addEventListener('resize', ajustarEscalaSlide);

// A altura precisa estar aplicada ANTES do dashboard carregar: se ele carregar
// dentro de um iframe curto, se desenha errado.
ajustarAltura();
recarregarDashboard();
requestAnimationFrame(animate);
