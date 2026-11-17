// Render only when the protected answer panel is visible; retain source on failure.
const answers = document.getElementById('l15-answers');
let rendering = false;
async function renderAnswers() {
  if (!answers?.open || rendering) return;
  rendering = true;
  try {
    const { default: mermaid } = await import('https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs');
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' });
    let i = 0;
    for (const figure of answers.querySelectorAll('.answer-schema')) {
      if (figure.dataset.rendered) continue;
      const { svg } = await mermaid.render(`answer-er-${i++}`, figure.querySelector('.mermaid-source').textContent);
      figure.querySelector('.mermaid-output').innerHTML = svg;
      figure.dataset.rendered = 'true';
    }
  } catch (error) {
    for (const figure of answers.querySelectorAll('.answer-schema:not([data-rendered])')) {
      figure.querySelector('details').open = true;
      figure.querySelector('.mermaid-output').textContent = 'Диаграмма не загрузилась. Код ниже можно открыть на mermaid.live.';
    }
    console.error('Answer diagrams:', error);
  } finally { rendering = false; }
}
answers?.addEventListener('toggle', renderAnswers);
renderAnswers();
