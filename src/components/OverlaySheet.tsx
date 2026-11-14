import React, { useEffect, useRef } from 'react';
import { ScrollView, ScrollViewInstance, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MAP_SCREEN_LAYERS } from '../utils/mapScreenLayout';

export interface OverlaySheetProps {
  title: string;
  accentColor: string;
  onClose: () => void;
  children: React.ReactNode;
  /**
   * Vierityspyyntö (#61): kun `scrollKey` vaihtuu ja `scrollToY` on tiedossa,
   * paneeli vierittää kerran kyseiseen kohtaan.
   */
  scrollKey?: string;
  scrollToY?: number | null;
}

/**
 * Alapaneelin yläpuolelle avautuva vieritettävä paneeli (tiketti #60).
 * Osa 2 (#61): Lisää-paneeli, johon Alue- ja Radio-pikavalinnat vierittävät.
 */
export function OverlaySheet(props: OverlaySheetProps) {
  const scrollRef = useRef<ScrollViewInstance>(null);
  const lastScrolledKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (props.scrollKey === undefined || props.scrollToY === undefined || props.scrollToY === null) {
      return;
    }
    if (lastScrolledKeyRef.current === props.scrollKey) return;
    lastScrolledKeyRef.current = props.scrollKey;
    scrollRef.current?.scrollTo({ y: props.scrollToY, animated: true });
  }, [props.scrollKey, props.scrollToY]);

  return (
    <View style={styles.sheet}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: props.accentColor }]}>{props.title}</Text>
        <TouchableOpacity onPress={props.onClose} style={styles.closeButton} activeOpacity={0.7}>
          <Text style={styles.closeText}>Sulje</Text>
        </TouchableOpacity>
      </View>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
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
