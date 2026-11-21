document.querySelectorAll('[data-copy-sql]').forEach((button) => {
  button.addEventListener('click', async () => {
    const code = button.closest('.quiz-sql').querySelector('pre code');
    try {
      await navigator.clipboard.writeText(code.textContent);
      button.textContent = 'Скопировано ✓';
    } catch {
      const range = document.createRange();
      range.selectNodeContents(code);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      button.textContent = 'Нажмите Ctrl+C / Cmd+C';
    }
    setTimeout(() => { button.textContent = 'Скопировать SQL'; }, 2500);
  });
});
