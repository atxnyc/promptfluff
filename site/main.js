'use strict';

const FALLBACK_PHRASES = [
  "You're amazing. End of story.",
  'You got this. Crush it.',
  "You're brilliant. Now go shine."
];

const HERO_TYPE_DURATION_MS = 1300;
const HERO_HOLD_MS = 2000;
const HERO_CLEAR_MS = 180;

// Thin, crash-proof wrappers around the RudderStack SDK. If an ad blocker keeps
// the snippet from running, window.rudderanalytics is undefined and these no-op.
function trackEvent(event, properties) {
  try {
    if (window.rudderanalytics && typeof window.rudderanalytics.track === 'function') {
      window.rudderanalytics.track(event, properties || {});
    }
  } catch (_error) {
    // Analytics must never break the page.
  }
}

function trackPage() {
  try {
    if (window.rudderanalytics && typeof window.rudderanalytics.page === 'function') {
      window.rudderanalytics.page();
    }
  } catch (_error) {
    // Analytics must never break the page.
  }
}

async function copyText(value, button) {
  try {
    await navigator.clipboard.writeText(value);
  } catch (_error) {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }

  const original = button.textContent;
  button.textContent = 'Copied';
  window.setTimeout(() => {
    button.textContent = original;
  }, 1200);
}

async function loadPhrases() {
  const response = await fetch('/data/encouragements.json');
  if (!response.ok) {
    throw new Error(`Phrase fetch failed: ${response.status}`);
  }
  const phrases = await response.json();
  const cleaned = phrases.filter((phrase) => typeof phrase === 'string' && phrase.trim());
  return cleaned.length > 0 ? cleaned : FALLBACK_PHRASES;
}

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function shuffled(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function createPhraseCycler(phrases) {
  let queue = shuffled(phrases);
  let index = 0;
  let previous = '';

  return () => {
    if (index >= queue.length) {
      queue = shuffled(phrases);
      index = 0;
    }

    let phrase = queue[index];
    index += 1;

    if (phrases.length > 1 && phrase === previous) {
      phrase = queue[index] || phrases.find((item) => item !== previous) || phrase;
      index += 1;
    }

    previous = phrase;
    return phrase;
  };
}

function typeHeroPhrase(output, phrase, onDone) {
  const startedAt = performance.now();
  output.textContent = '';

  function render(now) {
    const progress = Math.min((now - startedAt) / HERO_TYPE_DURATION_MS, 1);
    const nextLength = Math.floor(progress * phrase.length);
    output.textContent = phrase.slice(0, nextLength);

    if (progress < 1) {
      window.requestAnimationFrame(render);
      return;
    }

    output.textContent = phrase;
    onDone();
  }

  window.requestAnimationFrame(render);
}

function startHeroSession(phrases) {
  const output = document.querySelector('#hero-fluff-text');
  if (!output) {
    return;
  }

  const nextPhrase = createPhraseCycler(phrases);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (reduceMotion || phrases.length < 2) {
    output.textContent = nextPhrase();
    return;
  }

  function cycle() {
    typeHeroPhrase(output, nextPhrase(), () => {
      window.setTimeout(() => {
        output.textContent = '';
        window.setTimeout(cycle, HERO_CLEAR_MS);
      }, HERO_HOLD_MS);
    });
  }

  cycle();
}

document.addEventListener('DOMContentLoaded', () => {
  trackPage();

  document.querySelectorAll('[data-copy]').forEach((button) => {
    button.addEventListener('click', () => {
      copyText(button.dataset.copy, button);
      trackEvent('Install Command Copied', {
        method: button.dataset.method || 'unknown',
        command: button.dataset.copy
      });
    });
  });

  document.querySelectorAll('[data-event]').forEach((element) => {
    element.addEventListener('click', () => {
      trackEvent(element.dataset.event, { href: element.getAttribute('href') || undefined });
    });
  });

  const output = document.querySelector('#phrase-output');
  const phraseButton = document.querySelector('#phrase-button');
  let phrases = FALLBACK_PHRASES;

  const phrasePromise = loadPhrases()
    .then((loaded) => {
      phrases = loaded;
      return phrases;
    })
    .catch(() => {
      phrases = FALLBACK_PHRASES;
      return phrases;
    });

  phrasePromise.then(startHeroSession);

  phraseButton.addEventListener('click', () => {
    const phrase = randomItem(phrases);
    output.textContent = phrase;
    trackEvent('Encouragement Generated', { phrase });
  });
});
