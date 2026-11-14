import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MAP_SCREEN_LAYERS } from '../utils/mapScreenLayout';

export interface OverlaySheetProps {
  title: string;
  accentColor: string;
  onClose: () => void;
  children: React.ReactNode;
}

/**
 * Alapaneelin yläpuolelle avautuva vieritettävä paneeli (tiketti #60).
 * Sisältää toistaiseksi vanhan korttipinon osat; osa 2 (#61) järjestää ne uudelleen.
 */
export function OverlaySheet(props: OverlaySheetProps) {
  return (
    <View style={styles.sheet}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: props.accentColor }]}>{props.title}</Text>
        <TouchableOpacity onPress={props.onClose} style={styles.closeButton} activeOpacity={0.7}>
          <Text style={styles.closeText}>Sulje</Text>
        </TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {props.children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    maxHeight: '60%',
    backgroundColor: 'rgba(10, 14, 10, 0.97)',
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    borderTopWidth: 1,
    borderColor: '#2E3B2E',
    zIndex: MAP_SCREEN_LAYERS.sheet,
    elevation: MAP_SCREEN_LAYERS.sheet,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 4,
  },
  title: {
    flex: 1,
    fontWeight: 'bold',
    fontSize: 15,
  },
  closeButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#37474F',
  },
  closeText: {
    color: '#FFFFFF',
    fontSize: 13,
  },
  content: {
    padding: 14,
    paddingBottom: 24,
  },
});
