import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import { styled } from 'nativewind';

const StyledView = styled(View);
const StyledText = styled(Text);

export default function App() {
  return (
    <StyledView className="flex-1 items-center justify-center bg-[#0a0a0f]">
      <StyledText className="text-white text-2xl font-bold">Oddjob Mobile Forge</StyledText>
      <StyledText className="text-white/50 mt-2">Ready for mission instructions.</StyledText>
      <StatusBar style="light" />
    </StyledView>
  );
}
