import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, BlurView } from 'react-native';
import { styled } from 'nativewind';

const StyledView = styled(View);
const StyledText = styled(Text);
const StyledTouchableOpacity = styled(TouchableOpacity);

/**
 * Premium Glassmorphism Card
 */
export const GlassCard = ({ children, className = "" }: { children: React.ReactNode, className?: string }) => (
  <StyledView className={`bg-white/10 border border-white/20 rounded-2xl p-4 overflow-hidden ${className}`}>
    {children}
  </StyledView>
);

/**
 * Industrial Action Button
 */
export const ActionButton = ({ title, onPress, variant = "primary" }: { title: string, onPress: () => void, variant?: "primary" | "secondary" }) => (
  <StyledTouchableOpacity 
    onPress={onPress}
    className={`rounded-xl py-3 px-6 items-center justify-center ${variant === "primary" ? "bg-[#6366f1]" : "bg-white/10 border border-white/20"}`}
  >
    <StyledText className={`font-semibold ${variant === "primary" ? "text-white" : "text-white/70"}`}>
      {title}
    </StyledText>
  </StyledTouchableOpacity>
);

/**
 * Recursive Forge Trigger
 */
export const ForgeTrigger = ({ featureName, onTrigger }: { featureName: string, onTrigger: () => void }) => (
  <GlassCard className="mt-4 border-dashed border-indigo-500/50">
    <StyledText className="text-indigo-400 text-xs font-bold uppercase tracking-wider mb-2">Feature Gap Detected</StyledText>
    <StyledText className="text-white font-medium mb-3">Spawn specialist app for: {featureName}</StyledText>
    <ActionButton title="Trigger Sub-Forge" onPress={onTrigger} variant="secondary" />
  </GlassCard>
);
