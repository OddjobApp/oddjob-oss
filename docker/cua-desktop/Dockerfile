# Oddjob's computer-use desktop: the Cua XFCE desktop plus a Chromium that Oddjob can
# attach to over the DevTools protocol (CDP), which is what lets it record a person's
# actions during a takeover and replay them as a skill.
#
#   docker build -t oddjob/cua-desktop:latest docker/cua-desktop
#
# org-desktop.service.ts builds this automatically the first time it is missing.
FROM trycua/cua-xfce:latest

USER root

# Debian 12 ships a real chromium package (no snap).
RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

COPY oddjob-browser /usr/local/bin/oddjob-browser
COPY oddjob-desktop-init /usr/local/bin/oddjob-desktop-init
COPY oddjob-chromium.desktop /usr/share/xfce4/helpers/oddjob-chromium.desktop
COPY oddjob-chromium-app.desktop /usr/share/applications/oddjob-chromium.desktop
COPY oddjob-cdp-relay.conf /etc/supervisor/conf.d/oddjob-cdp-relay.conf
RUN chmod 0755 /usr/local/bin/oddjob-browser /usr/local/bin/oddjob-desktop-init \
    && sed -i 's/^WebBrowser=.*/WebBrowser=oddjob-chromium/' /etc/xdg/xfce4/helpers.rc \
    && update-alternatives --install /usr/bin/x-www-browser x-www-browser /usr/local/bin/oddjob-browser 300 \
    && update-alternatives --set x-www-browser /usr/local/bin/oddjob-browser

# 9223: CDP relay (Chromium itself only listens on 127.0.0.1:9222 inside the container).
EXPOSE 9223
