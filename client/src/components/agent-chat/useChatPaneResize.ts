import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useSidebarSafe } from '@/components/ui/sidebar';

export const DEFAULT_STUDIO_CHAT_WIDTH = 460;

export interface UseChatPaneResizeOptions {
  rootRef: React.RefObject<HTMLDivElement | null>;
  isCyclePipelineCollapsed?: boolean;
  hasMediaStudioActive?: boolean;
  isMediaRailCollapsed?: boolean;
}

export function useChatPaneResize({
  rootRef,
  isCyclePipelineCollapsed = false,
  hasMediaStudioActive = false,
  isMediaRailCollapsed = false,
}: UseChatPaneResizeOptions) {
  const sidebar = useSidebarSafe();

  // Robustly measure the left boundary of the main content area (right boundary of the left navigation sidebar).
  const [sidebarLeft, setSidebarLeft] = useState<number>(() => {
    if (typeof window === 'undefined') return 0;
    const mainEl =
      document.getElementById('main-content') ||
      document.querySelector<HTMLElement>('[data-slot="sidebar-inset"]');
    if (mainEl) {
      const left = Math.round(mainEl.getBoundingClientRect().left);
      if (left > 0) return left;
    }
    const sidebarContainer =
      document.querySelector<HTMLElement>('[data-slot="sidebar-container"]') ||
      document.querySelector<HTMLElement>('[data-sidebar="sidebar"]');
    if (sidebarContainer) {
      const rect = sidebarContainer.getBoundingClientRect();
      if (rect.width > 0 && rect.right > 0) return Math.round(rect.right);
    }
    return 0;
  });

  useEffect(() => {
    const updateSidebarLeft = () => {
      let measured = 0;
      if (rootRef.current) {
        const left = Math.round(rootRef.current.getBoundingClientRect().left);
        if (left > 0) measured = left;
      }
      if (!measured) {
        const mainEl =
          document.getElementById('main-content') ||
          document.querySelector<HTMLElement>('[data-slot="sidebar-inset"]');
        if (mainEl) {
          const left = Math.round(mainEl.getBoundingClientRect().left);
          if (left > 0) measured = left;
        }
      }
      if (!measured) {
        const sidebarContainer =
          document.querySelector<HTMLElement>('[data-slot="sidebar-container"]') ||
          document.querySelector<HTMLElement>('[data-sidebar="sidebar"]');
        if (sidebarContainer) {
          const rect = sidebarContainer.getBoundingClientRect();
          if (rect.width > 0 && rect.right > 0) measured = Math.round(rect.right);
        }
      }
      setSidebarLeft((prev) => (prev !== measured ? measured : prev));
    };

    updateSidebarLeft();

    // Schedule ticks across typical sidebar CSS transition durations (200ms - 300ms)
    const timers = [50, 100, 150, 200, 250, 300, 350, 400].map((ms) =>
      setTimeout(updateSidebarLeft, ms),
    );

    window.addEventListener('resize', updateSidebarLeft);
    window.addEventListener('transitionend', updateSidebarLeft, true);

    const mainEl =
      document.getElementById('main-content') ||
      document.querySelector('[data-slot="sidebar-inset"]') ||
      rootRef.current;
    const sidebarEl =
      document.querySelector('[data-slot="sidebar-container"]') ||
      document.querySelector('[data-sidebar="sidebar"]');

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateSidebarLeft) : null;
    if (mainEl && ro) ro.observe(mainEl);
    if (sidebarEl && ro) ro.observe(sidebarEl);
    if (rootRef.current && ro && rootRef.current !== mainEl) ro.observe(rootRef.current);

    const observer = new MutationObserver(updateSidebarLeft);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['data-state', 'data-collapsible', 'class', 'style'],
      subtree: true,
    });

    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener('resize', updateSidebarLeft);
      window.removeEventListener('transitionend', updateSidebarLeft, true);
      ro?.disconnect();
      observer.disconnect();
    };
  }, [sidebar?.open, sidebar?.state, sidebar?.isMobile, rootRef]);

  // ── Chat Pane Resizing & Dynamic Side-Rail Expansion ──────────────────────────
  const [userChatWidth, setUserChatWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return DEFAULT_STUDIO_CHAT_WIDTH;
    try {
      const saved = localStorage.getItem('oddjob:chat-pane-width');
      const parsed = saved ? parseInt(saved, 10) : NaN;
      if (!isNaN(parsed) && parsed >= 280 && parsed <= 1200) {
        return parsed;
      }
    } catch {}
    return DEFAULT_STUDIO_CHAT_WIDTH;
  });

  const [isDraggingChatWidth, setIsDraggingChatWidth] = useState(false);
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartWidthRef = useRef(0);

  // When a side rail closes (e.g. CyclePipelineRightRail collapses from 320px to 48px),
  // the chat pane dynamically expands to absorb the 272px freed horizontal space.
  const isAnyRailCollapsed = isCyclePipelineCollapsed || (hasMediaStudioActive && isMediaRailCollapsed);
  const sideRailExpansion = isAnyRailCollapsed ? 272 : 0;
  const rawChatWidth = userChatWidth + sideRailExpansion;
  const maxChatWidth = Math.max(
    380,
    (typeof window !== 'undefined' ? window.innerWidth : 1400) - sidebarLeft - (isAnyRailCollapsed ? 260 : 540),
  );
  const effectiveChatWidth = Math.max(280, Math.min(maxChatWidth, rawChatWidth));

  const handleStartResize = useCallback(
    (clientX: number) => {
      isDraggingRef.current = true;
      dragStartXRef.current = clientX;
      dragStartWidthRef.current = userChatWidth;
      setIsDraggingChatWidth(true);
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
    },
    [userChatWidth],
  );

  const handleMouseDownResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      handleStartResize(e.clientX);
    },
    [handleStartResize],
  );

  const handleTouchStartResize = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches[0]) {
        handleStartResize(e.touches[0].clientX);
      }
    },
    [handleStartResize],
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const deltaX = e.clientX - dragStartXRef.current;
      const proposed = dragStartWidthRef.current + deltaX;
      const clamped = Math.max(280, Math.min(maxChatWidth - sideRailExpansion, proposed));
      setUserChatWidth(clamped);
      try {
        localStorage.setItem('oddjob:chat-pane-width', String(Math.round(clamped)));
      } catch {}
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isDraggingRef.current || !e.touches[0]) return;
      const deltaX = e.touches[0].clientX - dragStartXRef.current;
      const proposed = dragStartWidthRef.current + deltaX;
      const clamped = Math.max(280, Math.min(maxChatWidth - sideRailExpansion, proposed));
      setUserChatWidth(clamped);
      try {
        localStorage.setItem('oddjob:chat-pane-width', String(Math.round(clamped)));
      } catch {}
    };

    const handleEndResize = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        setIsDraggingChatWidth(false);
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleEndResize);
    window.addEventListener('touchmove', handleTouchMove);
    window.addEventListener('touchend', handleEndResize);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleEndResize);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleEndResize);
      if (isDraggingRef.current) {
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
      }
    };
  }, [maxChatWidth, sideRailExpansion]);

  const handleResetChatWidth = useCallback(() => {
    setUserChatWidth(DEFAULT_STUDIO_CHAT_WIDTH);
    try {
      localStorage.setItem('oddjob:chat-pane-width', String(DEFAULT_STUDIO_CHAT_WIDTH));
    } catch {}
  }, []);

  const handleKeyResize = useCallback(
    (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? 40 : 15;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setUserChatWidth((prev) => Math.min(maxChatWidth - sideRailExpansion, prev + step));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setUserChatWidth((prev) => Math.max(280, prev - step));
      } else if (e.key === 'Enter' || e.key === 'Home') {
        e.preventDefault();
        handleResetChatWidth();
      }
    },
    [maxChatWidth, sideRailExpansion, handleResetChatWidth],
  );

  return {
    sidebarLeft,
    userChatWidth,
    effectiveChatWidth,
    maxChatWidth,
    isDraggingChatWidth,
    handleMouseDownResize,
    handleTouchStartResize,
    handleResetChatWidth,
    handleKeyResize,
  };
}
