window.clearLoginLoading = () => {
      const el = document.getElementById('login-loading');
      if (el) {
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 200);
      }
    };
