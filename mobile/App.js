// KaizenHub для телефона: сам сайт внутри приложения (WebView).
// Всё приложение живёт на сайте — обновления приходят без новой сборки.
import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { WebView } from 'react-native-webview';
import * as WebBrowser from 'expo-web-browser';

const SITE = 'https://kaizenhub-nu.vercel.app';
const HOST = new URL(SITE).host;
const BG = '#17171C';

// Google не пускает вход во встроенном браузере (WebView). Поэтому вход через Google идёт в системном окне входа iOS:
// перехватываем переход сайта на Supabase …/auth/v1/authorize, возвращаемся по адресу kaizenhub://auth
// и отдаём токены обратно сайту — supabase-js сам подхватит их из адреса (detectSessionInUrl).
const APP_RETURN = 'kaizenhub://auth';
const isGoogleLogin = url => /^https:\/\/accounts\.google\.com\//.test(url);
const isOAuthStart = url => /^https:\/\/[^/]+\.supabase\.co\/auth\/v1\/authorize\?/.test(url);

export default function App() {
  const web = useRef(null);
  const [failed, setFailed] = useState(false);

  const googleLogin = async url => {
    // окно входа открываем через app-auth.html: она отмечает, что вход из приложения, и после Google сайт вернёт нас сюда
    // (так не нужен отдельный адрес возврата в настройках Supabase)
    const back = new URL(url).searchParams.get('redirect_to') || SITE + '/';
    const r = await WebBrowser.openAuthSessionAsync(`${SITE}/app-auth.html?go=${encodeURIComponent(url)}`, APP_RETURN);
    if (r.type !== 'success' || !r.url) { web.current?.reload(); return; }        // закрыли окно — возвращаем экран входа
    const tail = r.url.slice(APP_RETURN.length);                                     // ?code=… или #access_token=…
    let target = back;
    if (tail.startsWith('?')) target = back + (back.includes('?') ? '&' : '?') + tail.slice(1).split('#')[0];
    const hash = tail.includes('#') ? tail.slice(tail.indexOf('#')) : '';
    web.current?.injectJavaScript(`location.href = ${JSON.stringify(target + hash)}; setTimeout(function(){ location.reload(); }, 80); true;`);
  };

  const onNav = req => {
    const { url } = req;
    if (isOAuthStart(url)) { googleLogin(url); return false; }
    if (/^(mailto|tel|sms|tg|whatsapp|itms-apps):/i.test(url)) { Linking.openURL(url).catch(() => {}); return false; }   // почта, телефон, Telegram, WhatsApp
    if (!/^https?:/.test(url)) return /^(about|blob|data):/i.test(url);                     // служебные адреса страницы — внутри, остальное не открываем
    if (isGoogleLogin(url)) {
      Alert.alert('Вход через Google', 'Не получилось открыть окно входа Google. Попробуйте ещё раз или войдите по почте и паролю.');
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
