const play = document.getElementById('play-film');
play?.addEventListener('click', () => {
  const frame = document.createElement('iframe');
  frame.title = 'LOTSPLIT — Different needs. One way forward. — final English demonstration';
  frame.src = 'https://www.youtube-nocookie.com/embed/gUwv5R6rCww?autoplay=1&rel=0&hl=en&cc_lang_pref=en&cc_load_policy=1';
  frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
  frame.allowFullscreen = true;
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  document.getElementById('film-player').replaceChildren(frame);
  frame.focus();
});
