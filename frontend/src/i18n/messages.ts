export const LOCALES = ['en', 'zh', 'ja'] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_LABELS: Record<Locale, string> = {
	en: 'English',
	zh: '中文',
	ja: '日本語',
};

const en = {
	'settings.theme': 'Theme',
	'settings.theme.light': 'Light',
	'settings.theme.dark': 'Dark',
	'settings.theme.system': 'System',
	'settings.language': 'Language',

	'auth.brand': 'Makeshift · Voice',
	'auth.welcome.login': 'Welcome back to the room.',
	'auth.welcome.signup': 'Step into the room.',
	'auth.field.username': 'Username',
	'auth.field.password': 'Password',
	'auth.field.invite': 'Invite code',
	'auth.action.login': 'Log in',
	'auth.action.login.loading': 'Logging in…',
	'auth.action.signup': 'Create account',
	'auth.action.signup.loading': 'Creating…',
	'auth.error.login': 'Login failed',
	'auth.error.signup': 'Signup failed',
	'auth.switch.toSignup': 'No account yet? Sign up',
	'auth.switch.toLogin': 'Already inside? Log in',

	'lobby.greeting': 'Hey, {name}.',
	'lobby.channels': 'Voice channels',
	'lobby.logout': 'Log out',

	'room.status.connecting': 'Connecting…',
	'room.status.reconnecting': 'Reconnecting…',
	'room.status.joining': 'Joining room…',
	'room.status.cannotConnect': 'Could not connect.',
	'room.error.join': 'Failed to join room',
	'room.you': '(you)',
	'room.sidebar.inRoom': 'In room — {count}',
	'room.action.mute': 'Mute',
	'room.action.unmute': 'Unmute',
	'room.action.leave': 'Leave',
} as const;

type MessageKey = keyof typeof en;
type Dict = Record<MessageKey, string>;

const zh: Dict = {
	'settings.theme': '主题',
	'settings.theme.light': '浅色',
	'settings.theme.dark': '深色',
	'settings.theme.system': '跟随系统',
	'settings.language': '语言',

	'auth.brand': 'Makeshift · 语音',
	'auth.welcome.login': '欢迎回来',
	'auth.welcome.signup': '一起聊聊',
	'auth.field.username': '用户名',
	'auth.field.password': '密码',
	'auth.field.invite': '邀请码',
	'auth.action.login': '登录',
	'auth.action.login.loading': '登录中…',
	'auth.action.signup': '注册',
	'auth.action.signup.loading': '注册中…',
	'auth.error.login': '登录失败',
	'auth.error.signup': '注册失败',
	'auth.switch.toSignup': '还没有账号？立即注册',
	'auth.switch.toLogin': '已有账号？立即登录',

	'lobby.greeting': '嗨，{name}',
	'lobby.channels': '语音频道',
	'lobby.logout': '退出登录',

	'room.status.connecting': '连接中…',
	'room.status.reconnecting': '重新连接中…',
	'room.status.joining': '正在加入…',
	'room.status.cannotConnect': '连接失败',
	'room.error.join': '加入房间失败',
	'room.you': '（我）',
	'room.sidebar.inRoom': '房间内 · {count} 人',
	'room.action.mute': '静音',
	'room.action.unmute': '取消静音',
	'room.action.leave': '离开',
};

const ja: Dict = {
	'settings.theme': 'テーマ',
	'settings.theme.light': 'ライト',
	'settings.theme.dark': 'ダーク',
	'settings.theme.system': 'システム',
	'settings.language': '言語',

	'auth.brand': 'Makeshift · ボイス',
	'auth.welcome.login': 'おかえりなさい。',
	'auth.welcome.signup': '部屋へどうぞ。',
	'auth.field.username': 'ユーザー名',
	'auth.field.password': 'パスワード',
	'auth.field.invite': '招待コード',
	'auth.action.login': 'ログイン',
	'auth.action.login.loading': 'ログイン中…',
	'auth.action.signup': 'アカウント作成',
	'auth.action.signup.loading': '作成中…',
	'auth.error.login': 'ログインに失敗しました',
	'auth.error.signup': 'アカウント作成に失敗しました',
	'auth.switch.toSignup': 'アカウントをお持ちでない方はこちら',
	'auth.switch.toLogin': 'すでにアカウントをお持ちの方',

	'lobby.greeting': 'やあ、{name}。',
	'lobby.channels': 'ボイスチャンネル',
	'lobby.logout': 'ログアウト',

	'room.status.connecting': '接続中…',
	'room.status.reconnecting': '再接続中…',
	'room.status.joining': '入室中…',
	'room.status.cannotConnect': '接続できませんでした。',
	'room.error.join': '入室に失敗しました',
	'room.you': '(あなた)',
	'room.sidebar.inRoom': '入室中 — {count}',
	'room.action.mute': 'ミュート',
	'room.action.unmute': 'ミュート解除',
	'room.action.leave': '退出',
};

export const MESSAGES: Record<Locale, Dict> = { en, zh, ja };
export type { MessageKey };
