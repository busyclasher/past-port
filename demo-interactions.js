/* Small progressive enhancement layer for the existing PastPort page. */
(() => {
  const app = document.getElementById('app');
  if (!app) return;
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = value => Math.max(0, Math.min(100, value));
  let dragging = null;
  let bypassNavigation = false;
  let turning = false;
  let speechAvailable = null;
  const landmarkPhotos = {
    central: {
      name: 'Toa Payoh Central',
      earlier: { year: '2006', src: '/photos/central-2006.jpg', author: 'Terence Ong', licence: 'CC BY 2.5', source: 'https://commons.wikimedia.org/wiki/File:Toa_Payoh_Central.JPG' },
      later: { year: '2022', src: '/photos/central-2022.jpg', author: 'Wzhkevin', licence: 'CC BY-SA 4.0', source: 'https://commons.wikimedia.org/wiki/File:Outdoor_shopping_mall_in_Toa_Payoh_Central_-_2022-04-16.jpg' },
    },
    playground: {
      name: 'Toa Payoh Dragon Playground',
      earlier: { year: '2013', src: '/photos/playground-2013.jpg', author: 'Jimmy Tan', licence: 'CC BY 2.0', source: 'https://commons.wikimedia.org/wiki/File:Dragon_playground_in_front_of_Block_28_Toa_Payoh_Lorong_6.jpg' },
      later: { year: '2025', src: '/photos/playground-2025.jpg', author: 'Chainwit.', licence: 'CC BY 4.0', source: 'https://commons.wikimedia.org/wiki/File:Original_%22Toa_Payoh_Dragon_Playground%22,_Singapore_(2025)_-_img_01.jpg' },
    },
    park: {
      name: 'Toa Payoh Town Park',
      earlier: { year: '2006', src: '/photos/park-2006.jpg', author: 'User:Sengkang', licence: 'free use', source: 'https://commons.wikimedia.org/wiki/File:Toa_Payoh_Town_Park_11,_Aug_06.JPG' },
      later: { year: '2011', src: '/photos/park-2011.jpg', author: 'XW Chong', licence: 'CC BY-SA 3.0', source: 'https://commons.wikimedia.org/wiki/File:TPY_town_park.jpg' },
    },
  };
  const photoImage = (photo, place, loading = 'lazy') => `<img src="${photo.src}" alt="${place}, photographed in ${photo.year}" loading="${loading}" decoding="async">`;
  const photoCredit = photo => `<a href="${photo.source}" target="_blank" rel="noopener noreferrer">${photo.year}: ${photo.author} · ${photo.licence} ↗</a>`;

  function enhanceLandmarkPhotos() {
    for (const card of app.querySelectorAll('[data-select-card]')) {
      const place = landmarkPhotos[card.dataset.selectCard];
      const thumb = card.querySelector('.thumb');
      if (place && thumb && !thumb.dataset.photoPlace) {
        thumb.innerHTML = photoImage(place.later, place.name);
        thumb.dataset.photoPlace = card.dataset.selectCard;
      }
    }
    const preview = app.querySelector('.map-preview');
    const selected = Object.entries(landmarkPhotos).find(([, place]) => place.name === preview?.querySelector('h3')?.textContent);
    const previewThumb = preview?.querySelector('.thumb');
    if (selected && previewThumb && !previewThumb.dataset.photoPlace) {
      previewThumb.innerHTML = photoImage(selected[1].later, selected[1].name);
      previewThumb.dataset.photoPlace = selected[0];
    }
    const booklet = app.querySelector('.book-page');
    const bookletPlace = Object.entries(landmarkPhotos).find(([, place]) => place.name === booklet?.querySelector('h2')?.textContent);
    const bookletHero = booklet?.querySelector('.hero-art');
    if (bookletPlace && bookletHero && !bookletHero.dataset.photoPlace) {
      bookletHero.innerHTML = photoImage(bookletPlace[1].later, bookletPlace[1].name);
      bookletHero.dataset.photoPlace = bookletPlace[0];
      bookletHero.insertAdjacentHTML('afterend', `<p class="photo-credit-inline">Photograph · ${photoCredit(bookletPlace[1].later)}</p>`);
    }
    if (!location.hash.startsWith('#place/')) return;
    const place = landmarkPhotos[location.hash.slice('#place/'.length).split('/')[0]];
    const hero = app.querySelector('.hero-art.illustrated-hero');
    if (!place || !hero || app.querySelector('#tab-story[aria-selected="true"]') || hero.dataset.photoPlace) return;
    hero.innerHTML = photoImage(place.later, place.name, 'eager');
    hero.classList.add('photo-hero');
    hero.dataset.photoPlace = location.hash.slice('#place/'.length).split('/')[0];
    const credit = app.querySelector('.art-credit');
    if (credit) credit.innerHTML = `Photograph · ${photoCredit(place.later)} · cropped for display`;
  }

  function showVoiceState() {
    if (speechAvailable !== false) return;
    for (const panel of app.querySelectorAll('[data-speech-memory]')) {
      const button = panel.querySelector('[data-speech-open]');
      if (!button || panel.querySelector('.speech-unavailable')) continue;
      button.disabled = true;
      const note = document.createElement('p');
      note.className = 'small muted speech-unavailable';
      note.style.marginTop = '8px';
      note.textContent = 'Live transcription is unavailable in this preview. You can type and save your reflection above.';
      button.after(note);
    }
  }

  function labelDiscoveryActions() {
    for (const card of app.querySelectorAll('[data-select-card]')) {
      const label = card.querySelector('.chevron');
      if (label && label.textContent !== 'Explore') label.textContent = 'Explore';
    }
    for (const pin of app.querySelectorAll('[data-pin]')) {
      const place = window.PastPortData?.find(item => item.id === pin.dataset.pin);
      if (!place) continue;
      const label = `Open ${place.name} story${pin.classList.contains('collected') ? ', collected' : ''}`;
      if (pin.getAttribute('aria-label') !== label) pin.setAttribute('aria-label', label);
    }
  }

  fetch('/api/speech-availability').then(response => response.ok ? response.json() : { available: false }).then(result => {
    speechAvailable = result.available === true;
    showVoiceState();
  }).catch(() => { speechAvailable = false; showVoiceState(); });

  function setSplit(frame, value) {
    const percentage = Math.round(clamp(value));
    frame.style.setProperty('--split', `${percentage}%`);
    const handle = frame.querySelector('.compare-handle');
    handle.setAttribute('aria-valuenow', String(percentage));
    handle.setAttribute('aria-valuetext', `${percentage}% of the ${frame.dataset.earlierYear} photograph visible`);
  }

  function addComparison() {
    if (!location.hash.startsWith('#place/') || !app.querySelector('#tab-story[aria-selected="true"]')) return;
    const hero = app.querySelector('.hero-art.illustrated-hero');
    if (!hero || app.querySelector('.comparison')) return;
    const place = landmarkPhotos[location.hash.slice('#place/'.length).split('/')[0]];
    if (!place) return;
    const comparison = document.createElement('section');
    comparison.className = 'comparison';
    comparison.setAttribute('aria-label', `Compare photographs of ${place.name}`);
    comparison.innerHTML = `<h2>Compare real photographs</h2><p>Two dated photographs of ${place.name}. They were taken from different viewpoints, so this is not an aligned before-and-after reconstruction.</p><div class="compare-frame" data-earlier-year="${place.earlier.year}" style="--split:50%"><div class="compare-art" aria-hidden="true">${photoImage(place.later, place.name, 'eager')}</div><div class="compare-art compare-art--earlier" aria-hidden="true">${photoImage(place.earlier, place.name, 'eager')}</div><span class="compare-tag compare-tag--left">${place.earlier.year} photograph</span><span class="compare-tag compare-tag--right">${place.later.year} photograph</span><span class="compare-divider" aria-hidden="true"></span><div class="compare-handle" role="slider" tabindex="0" aria-label="Reveal ${place.earlier.year} photograph" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50" aria-valuetext="50% of the ${place.earlier.year} photograph visible" aria-orientation="horizontal" aria-describedby="compare-help">↔</div></div><div class="compare-footer"><p id="compare-help">Drag the handle or use arrow keys. Reset returns the divider to the middle.</p><button class="compare-reset" type="button">Reset</button></div><p class="photo-credits">Photo credits · resized and cropped for display<br>${photoCredit(place.earlier)}<br>${photoCredit(place.later)}</p>`;
    hero.replaceWith(comparison);
    const credit = app.querySelector('.art-credit');
    credit?.remove();
    const storyNote = app.querySelector('#detail-panel .note');
    if (storyNote?.querySelector('h3')?.textContent === 'Historical image unavailable') {
      storyNote.querySelector('h3').textContent = 'About these photographs';
      storyNote.querySelector('p').textContent = 'These are documented photographs of the named place, not verified matching viewpoints or a reconstruction of its history.';
    }
    const sourceNote = [...app.querySelectorAll('#detail-panel p.small.muted')].find(note => note.textContent.startsWith('Place names are selected prototype stops.'));
    if (sourceNote) sourceNote.textContent = 'The photograph sources and reuse terms are linked above. The demo recollection and illustrated map are not historical evidence; further place-history verification is pending.';
  }

  const observer = new MutationObserver(() => { addComparison(); enhanceLandmarkPhotos(); showVoiceState(); labelDiscoveryActions(); });
  observer.observe(app, { childList: true, subtree: true });
  addComparison();
  enhanceLandmarkPhotos();
  labelDiscoveryActions();

  document.addEventListener('pointerdown', event => {
    const handle = event.target.closest('.compare-handle');
    if (!handle) return;
    dragging = { handle, frame: handle.closest('.compare-frame'), pointerId: event.pointerId };
    handle.setPointerCapture(event.pointerId);
    const rect = dragging.frame.getBoundingClientRect();
    setSplit(dragging.frame, (event.clientX - rect.left) / rect.width * 100);
  });
  document.addEventListener('pointermove', event => {
    if (!dragging || dragging.pointerId !== event.pointerId) return;
    const rect = dragging.frame.getBoundingClientRect();
    setSplit(dragging.frame, (event.clientX - rect.left) / rect.width * 100);
  });
  for (const name of ['pointerup', 'pointercancel']) document.addEventListener(name, event => {
    if (dragging?.pointerId === event.pointerId) dragging = null;
  });
  document.addEventListener('keydown', event => {
    if (!event.target.matches('.compare-handle')) return;
    const frame = event.target.closest('.compare-frame');
    const current = Number(event.target.getAttribute('aria-valuenow'));
    const next = event.key === 'ArrowLeft' ? current - 5 : event.key === 'ArrowRight' ? current + 5 : event.key === 'Home' ? 0 : event.key === 'End' ? 100 : null;
    if (next === null) return;
    event.preventDefault();
    setSplit(frame, next);
  });
  document.addEventListener('click', event => {
    const reset = event.target.closest('.compare-reset');
    if (reset) setSplit(reset.closest('.comparison').querySelector('.compare-frame'), 50);
  });

  // A card or pin keeps the existing selected-pin state, then opens its story.
  document.addEventListener('click', event => {
    if (bypassNavigation) return;
    const button = event.target.closest('button[data-select-card],button[data-pin]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const id = button.dataset.selectCard || button.dataset.pin;
    bypassNavigation = true;
    button.click();
    bypassNavigation = false;
    location.hash = `place/${id}`;
  }, true);

  async function animateSheet(element, frames, duration) {
    if (!element?.animate || reducedMotion()) return;
    try {
      await element.animate(frames, { duration, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' }).finished;
    } catch { /* Navigation can detach a sheet mid-turn. */ }
  }
  function continueClick(button) {
    bypassNavigation = true;
    button.click();
    bypassNavigation = false;
  }
  document.addEventListener('click', async event => {
    if (bypassNavigation || reducedMotion()) return;
    const pageButton = event.target.closest('button[data-page]');
    const coverButton = event.target.closest('button[data-book]');
    if (!pageButton && !coverButton) return;
    if (pageButton?.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    if (turning) return;
    turning = true;
    const route = location.hash;
    if (coverButton) {
      const cover = app.querySelector('.cover');
      await animateSheet(cover, [{ transform: 'perspective(1200px) rotateY(0deg)', opacity: 1 }, { transform: 'perspective(1200px) rotateY(-85deg)', opacity: .25 }], 350);
      if (location.hash === route) continueClick(coverButton);
      turning = false;
      return;
    }
    const direction = Number(pageButton.dataset.page);
    const sheet = app.querySelector('.book-page');
    if (sheet) sheet.style.transformOrigin = direction > 0 ? 'left center' : 'right center';
    await animateSheet(sheet, [{ transform: 'perspective(1200px) rotateY(0deg)', opacity: 1 }, { transform: `perspective(1200px) rotateY(${direction > 0 ? -85 : 85}deg)`, opacity: .25 }], 210);
    if (location.hash !== route) { turning = false; return; }
    window.addEventListener('hashchange', () => requestAnimationFrame(() => {
      const incoming = app.querySelector('.book-page');
      if (incoming && !reducedMotion()) {
        incoming.style.transformOrigin = direction > 0 ? 'left center' : 'right center';
        incoming.animate([{ transform: `perspective(1200px) rotateY(${direction > 0 ? 75 : -75}deg)`, opacity: .35 }, { transform: 'perspective(1200px) rotateY(0deg)', opacity: 1 }], { duration: 250, easing: 'cubic-bezier(.2,.7,.2,1)' });
      }
      turning = false;
    }), { once: true });
    continueClick(pageButton);
  }, true);
})();
