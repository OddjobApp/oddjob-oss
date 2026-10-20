window._bootTimer = setTimeout(function() {
      var el = document.getElementById('boot-loader');
      if (el) { el.classList.add('hide'); setTimeout(function() { el.remove(); }, 350); }
    }, 4000);
    window.clearBootstrapTimer = function() {
      clearTimeout(window._bootTimer);
      var el = document.getElementById('boot-loader');
      if (el) { el.classList.add('hide'); setTimeout(function() { el.remove(); }, 350); }
    };
