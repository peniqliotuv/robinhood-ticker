function removeClass(el, className) {
  if (el.classList.contains(className)) {
    el.classList.remove(className);
  }
}

function addClass(el, className) {
  if (!el.classList.contains(className)) {
    el.classList.add(className);
  }
}

module.exports = {
  removeClass,
  addClass
};
