function removeClass(el, className) {
  if (el.classList.contains(className)) {
    el.classList.remove(className);
  }
}

module.exports = {
  removeClass
};
