"use client";
import React from 'react';
import { usePathname } from 'next/navigation';
import { DurableHandoffInboxView } from './DurableHandoffInboxView';
export function DurableHandoffInbox() {
  return <DurableHandoffInboxView pathname={usePathname()} />;
}
