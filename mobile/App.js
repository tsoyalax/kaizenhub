// KaizenHub для телефона: сам сайт внутри приложения (WebView).
// Всё приложение живёт на сайте — обновления приходят без новой сборки.
import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { WebView } from 'react-native-webview';

const SITE = 'https://kaizenhub-nu.vercel.app';
const HOST = new URL(SITE).host;
const BG = '#17171C';

// Google не пускает вход внутри встроенных браузеров приложений — в приложении входим по почте и паролю
const isGoogleLogin = url => /^https:\/\/accounts\.google\.com\//.test(url);

export default function App() {
  const web = useRef(null);
  const [failed, setFailed] = useState(false);

  const onNav = req => {
    const { url } = req;
    if (/^(mailto|tel|sms|tg|whatsapp|itms-apps):/i.test(url)) { Linking.openURL(url).catch(() => {}); return false; }   // почта, телефон, Telegram, WhatsApp
    if (!/^https?:/.test(url)) return /^(about|blob|data):/i.test(url);                     // служебные адреса страницы — внутри, остальное не открываем
    if (isGoogleLogin(url)) {
      Alert.alert('Вход через Google', 'Google не разрешает вход внутри приложений. Войдите по почте и паролю — или откройте KaizenHub в Safari.',
        [{ text: 'Понятно' }, { text: 'Открыть в Safari', onPress: () => Linking.openURL(SITE) }]);
      return false;
    }
    const host = new URL(url).host;
    if (host === HOST || host.endsWith('.supabase.co')) return true;
    if (req.navigationType === 'click' || req.isTopFrame) { Linking.openURL(url).catch(() => {}); return false; }   // чужие ссылки — в Safari
    return true;
  };

  if (failed) return (
    <View style={[s.fill, s.center]}>
      <StatusBar style="light" />
      <Text style={s.title}>Нет связи</Text>
      <Text style={s.text}>Проверьте интернет и попробуйте снова.</Text>
      <Pressable style={s.btn} onPress={() => setFailed(false)}><Text style={s.btnText}>Повторить</Text></Pressable>
    </View>
  );

  return (
    <View style={s.fill}>
      <StatusBar style="auto" />
      <WebView
        ref={web}
        source={{ uri: SITE }}
        style={s.fill}
        originWhitelist={['*']}
        onShouldStartLoadWithRequest={onNav}
        setSupportMultipleWindows={false}
        sharedCookiesEnabled
        domStorageEnabled
        javaScriptEnabled
        allowsBackForwardNavigationGestures
        pullToRefreshEnabled
        allowsInlineMediaPlayback
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
        startInLoadingState
        renderLoading={() => <View style={[StyleSheet.absoluteFill, s.center]}><ActivityIndicator color="#fff" /></View>}
        onError={() => setFailed(true)}
        onContentProcessDidTerminate={() => web.current?.reload()}
      />
    </View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: BG },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { color: '#fff', fontSize: 20, fontWeight: '600', marginBottom: 8 },
  text: { color: '#B5B5BD', fontSize: 15, textAlign: 'center', marginBottom: 20 },
  btn: { backgroundColor: '#fff', paddingHorizontal: 22, paddingVertical: 12, borderRadius: 12 },
  btnText: { color: BG, fontSize: 16, fontWeight: '600' },
});
