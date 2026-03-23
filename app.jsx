const { useState, useEffect, useRef } = React;

const CLIENT_ID = '267244090541-l41q931ig7rr9rhktn3sk3dkekljrpj9.apps.googleusercontent.com';
const API_KEY = 'AIzaSyCrVxI0mUvTptWE5CnrXQmQy84H2SEROZk';
const SCOPES = 'https://www.googleapis.com/auth/calendar.readonly';
const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest';

// カスタムCSSをインラインで追加
const style = document.createElement('style');
style.textContent = `
    @keyframes fadeIn {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
    }
    .animate-fadeIn {
        animation: fadeIn 0.5s ease-out forwards;
    }
    .custom-scrollbar::-webkit-scrollbar {
        width: 6px;
        height: 6px;
    }
    .custom-scrollbar::-webkit-scrollbar-track {
        background: rgba(255, 255, 255, 0.1);
        border-radius: 10px;
    }
    .custom-scrollbar::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.3);
        border-radius: 10px;
    }
    .custom-scrollbar::-webkit-scrollbar-thumb:hover {
        background: rgba(255, 255, 255, 0.5);
    }
    .hover\\:border-4B5EAA:hover {
        border-color: #4B5EAA !important;
    }
    .hover\\:bg-gray-600:hover {
        background-color: #374151 !important;
    }
    .hover\\:bg-gray-700:hover {
        background-color: #2F333A !important;
    }
    .hover\\:bg-gray-200:hover {
        background-color: #4B5563 !important;
    }
    @media (max-width: 640px) {
        .mobile-no-scroll {
            max-width: 100vw;
            overflow-x: hidden;
        }
        .mobile-no-scroll > * {
            max-width: 100%;
            overflow-x: auto;
        }
    }
    .notion-dark {
        background-color: #202226;
        color: #D1D5DB;
    }
    .element-bg {
        background-color: #2e3033;
    }
    .custom-button {
        background: linear-gradient(to right, #6d9eeb, #6fa8dc);
        color: #D1D5DB;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
        transition: transform 0.1s ease, box-shadow 0.1s ease, background 0.3s ease;
    }
    .custom-button:hover {
        background: linear-gradient(to right, #5b88d6, #5d95c3);
    }
    .custom-button:active {
        transform: translateY(2px);
        box-shadow: 0 2px 3px rgba(0, 0, 0, 0.2);
    }
    .timeline-date {
        white-space: nowrap;
        text-align: center;
    }
    .day-checkbox {
        display: none;
    }
    .day-label {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 2rem;
        height: 2rem;
        border: 1px solid #ffffff;
        border-radius: 50%;
        color: #ffffff;
        cursor: pointer;
        background: linear-gradient(to right, #6d9eeb, #6fa8dc);
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
        transition: transform 0.1s ease, box-shadow 0.1s ease, background 0.3s ease;
        text-align: center;
        pointer-events: auto;
    }
    .day-checkbox:not(:checked) + .day-label {
        background: transparent;
    }
    .day-label:hover {
        background: linear-gradient(to right, #5b88d6, #5d95c3);
    }
    .day-label:active {
        transform: translateY(2px);
        box-shadow: 0 2px 3px rgba(0, 0, 0, 0.2);
    }
    .tooltip {
        position: relative;
    }
    .tooltip .tooltip-text {
        visibility: hidden;
        width: 200px;
        background-color: #374151;
        color: #D1D5DB;
        text-align: center;
        border-radius: 6px;
        padding: 5px;
        position: absolute;
        z-index: 1;
        bottom: 125%;
        left: 50%;
        margin-left: -100px;
        opacity: 0;
        transition: opacity 0.3s;
        font-size: 0.75rem;
    }
    .tooltip:hover .tooltip-text {
        visibility: visible;
        opacity: 1;
    }
`;
document.head.appendChild(style);

function App() {
    const [isSignedIn, setIsSignedIn] = useState(false);
    const [calendars, setCalendars] = useState([]);
    const [selectedCalendars, setSelectedCalendars] = useState([]);
    const [startDate, setStartDate] = useState(() => new Date().toISOString().split('T')[0]);
    const [endDate, setEndDate] = useState(() => {
        const date = new Date();
        date.setDate(date.getDate() + 7);
        return date.toISOString().split('T')[0];
    });
    const [maxEndDate, setMaxEndDate] = useState(() => {
        const date = new Date();
        date.setDate(date.getDate() + 40);
        return date.toISOString().split('T')[0];
    });
    const [startTime, setStartTime] = useState('09:00');
    const [endTime, setEndTime] = useState('17:00');
    const [minDuration, setMinDuration] = useState(60);
    const [includedDays, setIncludedDays] = useState([1, 2, 3, 4, 5]);
    const [outputFormat, setOutputFormat] = useState('range');
    const [freeTimes, setFreeTimes] = useState([]);
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isUsageOpen, setIsUsageOpen] = useState(false);
    const [usageGuide, setUsageGuide] = useState(null);
    const [isGuideLoading, setIsGuideLoading] = useState(true);
    const [hasScrolled, setHasScrolled] = useState(false);
    const [isGapiInitialized, setIsGapiInitialized] = useState(false);
    const freeTimesRef = useRef(null);

    useEffect(() => {
        const start = new Date(startDate);
        const maxDate = new Date(start);
        maxDate.setDate(start.getDate() + 40);
        setMaxEndDate(maxDate.toISOString().split('T')[0]);

        const currentEndDate = new Date(endDate);
        if (currentEndDate > maxDate) {
            setEndDate(maxDate.toISOString().split('T')[0]);
        }
    }, [startDate]);

    useEffect(() => {
        function initClient() {
            if (!window.gapi) {
                setError('Google APIライブラリが読み込まれていません');
                console.error('Google APIライブラリが利用できません');
                return;
            }
            gapi.load('client', () => {
                gapi.client.init({
                    apiKey: API_KEY,
                    discoveryDocs: [DISCOVERY_DOC],
                }).then(() => {
                    console.log('Google APIクライアント初期化成功');
                    setIsGapiInitialized(true);
                }).catch(error => {
                    console.error('Google API初期化エラー:', JSON.stringify(error, null, 2));
                    setError('Google APIの初期化に失敗しました: ' + JSON.stringify(error, null, 2));
                });
            });
        }
        initClient();

        setIsGuideLoading(true);
        fetch('/freetime/usage-guide.json')
            .then(response => {
                if (!response.ok) throw new Error('JSONの取得に失敗しました');
                return response.json();
            })
            .then(data => setUsageGuide(data))
            .catch(error => {
                console.error('使い方ガイドの読み込みエラー:', error);
                setError('使い方ガイドの読み込みに失敗しました: ' + error.message);
            })
            .finally(() => setIsGuideLoading(false));
    }, []);

    useEffect(() => {
        if (!isGapiInitialized) return;

        const urlParams = new URLSearchParams(window.location.hash.substring(1));
        const accessToken = urlParams.get('access_token');
        if (accessToken) {
            console.log('リダイレクトからトークンを取得:', accessToken);
            setIsSignedIn(true);
            gapi.client.setToken({ access_token: accessToken });
            gapi.client.calendar.calendarList.list().then(response => {
                setCalendars(response.result.items);
                window.history.replaceState({}, document.title, window.location.pathname);
            }).catch(error => {
                console.error('カレンダー取得エラー:', error);
                setError('カレンダーの取得に失敗しました: ' + error.message);
            });
        }
    }, [isGapiInitialized]);

    useEffect(() => {
        if (freeTimes.length > 0 && !hasScrolled && freeTimesRef.current) {
            freeTimesRef.current.scrollIntoView({ behavior: 'smooth' });
            setHasScrolled(true);
        }
    }, [freeTimes, hasScrolled]);

    const handleSignIn = () => {
        if (!window.gapi) {
            setError('Google APIライブラリが読み込まれていません');
            return;
        }

        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
            `client_id=${encodeURIComponent(CLIENT_ID)}&` +
            `redirect_uri=${encodeURIComponent('https://sumalab.online/freetime/')}&` +
            `response_type=token&` +
            `scope=${encodeURIComponent(SCOPES)}&` +
            `prompt=consent`;

        window.location.href = authUrl;
    };

    const handleSignOut = () => {
        if (!window.gapi || !gapi.client) {
            setError('Google APIライブラリが利用できません');
            return;
        }
        gapi.client.setToken(null);
        setIsSignedIn(false);
        setCalendars([]);
        setFreeTimes([]);
        setEvents([]);
        setError(null);
        setHasScrolled(false);
        console.log('ログアウト成功');
        setIsMenuOpen(false);
    };

    const handleDayToggle = (day) => {
        setIncludedDays(prev =>
            prev.includes(day)
                ? prev.filter(d => d !== day)
                : [...prev, day].sort()
        );
    };

    const fetchFreeTimes = async () => {
        if (!window.gapi || !gapi.client) {
            setError('Google APIライブラリが利用できません');
            setLoading(false);
            return;
        }

        setLoading(true);
        setFreeTimes([]);
        setEvents([]);
        setError(null);

        if (!startDate || !endDate) {
            setError('開始日と終了日を選択してください');
            setLoading(false);
            return;
        }

        if (selectedCalendars.length === 0) {
            setError('少なくとも1つのカレンダーを選択してください');
            setLoading(false);
            return;
        }

        if (includedDays.length === 0) {
            setError('少なくとも1つの曜日を選択してください');
            setLoading(false);
            return;
        }

        const startDateTime = new Date(`${startDate}T${startTime}:00`);
        const endDateTime = new Date(`${endDate}T${endTime}:00`);

        try {
            const allEvents = [];
            for (const calendarId of selectedCalendars) {
                const response = await gapi.client.calendar.events.list({
                    calendarId: calendarId,
                    timeMin: startDateTime.toISOString(),
                    timeMax: endDateTime.toISOString(),
                    singleEvents: true,
                    orderBy: 'startTime',
                });

                if (!response.result || !response.result.items) {
                    throw new Error(`カレンダー ${calendarId} のイベント取得に失敗しました`);
                }

                console.log(`カレンダー ${calendarId} のイベント数: ${response.result.items.length}`);
                const calendarEvents = response.result.items
                    .map(event => {
                        const start = new Date(event.start.dateTime || event.start.date);
                        const end = new Date(event.end.dateTime || event.end.date);
                        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
                            console.warn(`無効なイベント（ID: ${event.id}）をスキップ:`, event);
                            return null;
                        }
                        return { start, end };
                    })
                    .filter(event => event !== null);

                allEvents.push(...calendarEvents);
            }

            setEvents(allEvents);

            const freeSlots = [];
            let current = new Date(startDateTime);

            while (current < endDateTime) {
                if (!includedDays.includes(current.getDay())) {
                    current.setDate(current.getDate() + 1);
                    current.setHours(parseInt(startTime.split(':')[0]), parseInt(startTime.split(':')[1]), 0, 0);
                    continue;
                }

                const nextDay = new Date(current);
                nextDay.setDate(nextDay.getDate() + 1);
                nextDay.setHours(parseInt(startTime.split(':')[0]), parseInt(startTime.split(':')[1]), 0, 0);

                const dayEnd = new Date(current);
                dayEnd.setHours(parseInt(endTime.split(':')[0]), parseInt(endTime.split(':')[1]), 0, 0);

                while (current < dayEnd && current < endDateTime) {
                    const slotEnd = new Date(current.getTime() + minDuration * 60 * 1000);
                    if (slotEnd > dayEnd) break;

                    const isFree = !allEvents.some(event => {
                        if (!event.start.getHours() && !event.start.getMinutes()) {
                            const eventDate = event.start.toISOString().split('T')[0];
                            const slotDate = current.toISOString().split('T')[0];
                            return eventDate === slotDate;
                        }
                        return current < event.end && slotEnd > event.start;
                    });

                    if (isFree) {
                        freeSlots.push({ start: new Date(current), end: new Date(slotEnd) });
                    }

                    current = slotEnd;
                }

                current = nextDay;
            }

            setFreeTimes(freeSlots);
        } catch (error) {
            console.error('ヒマ時間取得エラー:', error);
            setError('ヒマ時間の取得に失敗しました: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    const formatFreeTimes = () => {
        if (outputFormat === 'range') {
            const mergedSlots = [];
            let currentSlot = null;

            freeTimes.forEach(slot => {
                if (!currentSlot) {
                    currentSlot = { start: slot.start, end: slot.end };
                } else if (currentSlot.end.getTime() === slot.start.getTime()) {
                    currentSlot.end = slot.end;
                } else {
                    mergedSlots.push(currentSlot);
                    currentSlot = { start: slot.start, end: slot.end };
                }
            });

            if (currentSlot) {
                mergedSlots.push(currentSlot);
            }

            const groupedByDate = mergedSlots.reduce((acc, slot) => {
                const date = slot.start.toLocaleDateString('ja-JP', { weekday: 'short', month: 'long', day: 'numeric' });
                if (!acc[date]) acc[date] = [];
                acc[date].push(`${slot.start.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}〜${slot.end.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}`);
                return acc;
            }, {});

            return Object.entries(groupedByDate).map(([date, times]) => `- ${date} ${times.join(' / ')}`).join('\n');
        } else {
            const groupedByDate = freeTimes.reduce((acc, slot) => {
                const date = slot.start.toLocaleDateString('ja-JP', { weekday: 'short', month: 'long', day: 'numeric' });
                if (!acc[date]) acc[date] = [];
                let current = new Date(slot.start);
                while (current < slot.end) {
                    acc[date].push(current.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }));
                    current.setMinutes(current.getMinutes() + 30);
                }
                return acc;
            }, {});

            return Object.entries(groupedByDate).map(([date, times]) => `- ${date} ${times.join('、')}`).join('\n');
        }
    };

    const copyToClipboard = () => {
        navigator.clipboard.writeText(formatFreeTimes()).then(() => {
            alert('クリップボードにコピーしました！');
        }).catch(error => {
            console.error('コピーエラー:', error);
            setError('クリップボードへのコピーに失敗しました');
        });
    };

    const renderTimeline = () => {
        const timeline = [];
        const startHour = parseInt(startTime.split(':')[0]);
        const endHour = parseInt(endTime.split(':')[0]);
        const dateRange = [];
        let currentDate = new Date(startDate);
        const end = new Date(endDate);

        while (currentDate <= end) {
            if (includedDays.includes(currentDate.getDay())) {
                dateRange.push(new Date(currentDate));
            }
            currentDate.setDate(currentDate.getDate() + 1);
        }

        for (let hour = startHour; hour <= endHour; hour++) {
            const row = (
                <tr key={hour}>
                    <td className="p-1 text-xs whitespace-nowrap bg-gray-700 text-gray-200" style={{ border: '1px solid #374151' }}>{`${hour}:00`}</td>
                    {dateRange.map(date => {
                        const slotStart = new Date(date);
                        slotStart.setHours(hour, 0, 0, 0);
                        const slotEnd = new Date(slotStart);
                        slotEnd.setHours(hour + 1, 0, 0, 0);

                        const isBusy = events.some(event =>
                            slotStart < event.end && slotEnd > event.start
                        );

                        return (
                            <td
                                key={`${date.toISOString()}-${hour}`}
                                className="p-1 text-xs text-center"
                                style={{ border: '1px solid #374151', backgroundColor: isBusy ? '#2e3033' : '#374151', color: isBusy ? '#D1D5DB' : '#ffffff' }}
                            >
                                {!isBusy && 'ヒマ'}
                            </td>
                        );
                    })}
                </tr>
            );
            timeline.push(row);
        }

        return (
            <div className="w-full overflow-x-auto custom-scrollbar flex justify-center min-w-fit">
                <table className="border-collapse inline-table" style={{ border: '1px solid #374151' }}>
                    <thead>
                        <tr>
                            <th className="p-1 text-xs whitespace-nowrap bg-gray-700 text-gray-200" style={{ border: '1px solid #374151' }}>時間</th>
                            {dateRange.map(date => {
                                const dayOfWeek = date.getDay();
                                const color = dayOfWeek === 6 ? '#6d9eeb' : dayOfWeek === 0 ? '#e06666' : '#D1D5DB';
                                const formattedDate = `${date.getMonth() + 1}/${date.getDate()}(${['日', '月', '火', '水', '木', '金', '土'][dayOfWeek]})`;
                                return (
                                    <th
                                        key={date.toISOString()}
                                        className="p-1 text-xs whitespace-nowrap timeline-date"
                                        style={{ border: '1px solid #374151', color }}
                                    >
                                        {formattedDate}
                                    </th>
                                );
                            })}
                        </tr>
                    </thead>
                    <tbody>{timeline}</tbody>
                </table>
            </div>
        );
    };

    return (
        <div className="container mx-auto p-4 overflow-x-hidden relative notion-dark" style={{ maxWidth: '680px' }}>
            <h1 className="text-2xl font-bold mb-2 text-center text-D1D5DB">ヒマリスト</h1>
            <p className="text-sm text-gray-400 text-center mb-4">忙しい毎日に、ぴったりのヒマ時間を見つける</p>
            {/* ハンバーガーメニュー */}
            <button
                className="fixed top-4 right-4 bg-[#2e3033] px-5 py-3 rounded text-lg z-50"
                onClick={() => setIsMenuOpen(!isMenuOpen)}
            >
                ☰
            </button>

            {/* サイドメニュー */}
            <div className={`fixed top-0 right-0 h-full w-64 bg-gray-800 shadow-lg transform transition-transform duration-300 z-50 ${isMenuOpen ? 'translate-x-0' : 'translate-x-full'}`}>
                <div className="p-4">
                    <button
                        className="absolute top-4 right-4 text-gray-300 hover:text-D1D5DB"
                        onClick={() => setIsMenuOpen(false)}
                    >
                        ✕
                    </button>
                    <div className="mt-12 space-y-4">
                        {isSignedIn && (
                            <button
                                className="w-full bg-transparent text-gray-200 px-3 py-2 rounded text-sm hover:bg-gray-700 transition-all duration-200"
                                onClick={handleSignOut}
                            >
                                ログアウト
                            </button>
                        )}
                        <button
                            className="w-full custom-button px-3 py-2 rounded text-sm"
                            onClick={() => {
                                setIsMenuOpen(false);
                                setIsUsageOpen(true);
                            }}
                        >
                            使い方
                        </button>
                    </div>
                </div>
            </div>

            {error && (
                <div className="bg-red-800 text-red-200 px-4 py-3 rounded-lg mb-4 shadow-lg">
                    {error}
                </div>
            )}

            {!isSignedIn ? (
                <button
                    className="custom-button px-4 py-2 rounded-lg mx-auto block shadow-lg"
                    onClick={handleSignIn}
                >
                    Googleでログイン
                </button>
            ) : (
                <div>
                    <div className="p-8 rounded-lg shadow-lg element-bg mb-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="flex flex-col">
                                <label className="block mb-1 text-D1D5DB">開始日</label>
                                <input
                                    type="date"
                                    value={startDate}
                                    onChange={e => setStartDate(e.target.value)}
                                    className="border p-2 w-full sm:max-w-xs rounded hover:border-4B5EAA bg-gray-700 text-D1D5DB transition-all duration-200"
                                />
                            </div>
                            <div className="flex flex-col">
                                <label className="block mb-1 text-D1D5DB">終了日</label>
                                <input
                                    type="date"
                                    value={endDate}
                                    onChange={e => setEndDate(e.target.value)}
                                    max={maxEndDate}
                                    className="border p-2 w-full sm:max-w-xs rounded hover:border-4B5EAA bg-gray-700 text-D1D5DB transition-all duration-200"
                                />
                            </div>
                            <div className="flex flex-col">
                                <label className="block mb-1 text-D1D5DB">開始時間</label>
                                <input
                                    type="time"
                                    value={startTime}
                                    onChange={e => setStartTime(e.target.value)}
                                    step="1800"
                                    className="border p-2 w-full sm:max-w-xs rounded hover:border-4B5EAA bg-gray-700 text-D1D5DB transition-all duration-200"
                                />
                            </div>
                            <div className="flex flex-col">
                                <label className="block mb-1 text-D1D5DB">終了時間</label>
                                <input
                                    type="time"
                                    value={endTime}
                                    onChange={e => setEndTime(e.target.value)}
                                    step="1800"
                                    className="border p-2 w-full sm:max-w-xs rounded hover:border-4B5EAA bg-gray-700 text-D1D5DB transition-all duration-200"
                                />
                            </div>
                            <div className="flex flex-col">
                                <label className="block mb-1 text-D1D5DB tooltip">
                                    最小ヒマ時間（分）
                                    <span className="tooltip-text">抽出する空き時間の最小単位を指定</span>
                                </label>
                                <select
                                    value={minDuration}
                                    onChange={e => setMinDuration(parseInt(e.target.value))}
                                    className="border p-2 w-full sm:max-w-xs rounded hover:border-4B5EAA bg-gray-700 text-D1D5DB transition-all duration-200"
                                >
                                    <option value="30">30</option>
                                    <option value="60">60</option>
                                    <option value="90">90</option>
                                    <option value="120">120</option>
                                    <option value="150">150</option>
                                    <option value="180">180</option>
                                </select>
                            </div>
                            <div className="flex flex-col">
                                <label className="block mb-1 text-D1D5DB">出力形式</label>
                                <select
                                    value={outputFormat}
                                    onChange={e => setOutputFormat(e.target.value)}
                                    className="border p-2 w-full sm:max-w-xs rounded hover:border-4B5EAA bg-gray-700 text-D1D5DB transition-all duration-200"
                                >
                                    <option value="range">時間範囲</option>
                                    <option value="slots">30分刻み</option>
                                </select>
                            </div>
                            <div className="col-span-2">
                                <label className="block mb-1 text-D1D5DB">曜日選択</label>
                                <div className="flex justify-center gap-4">
                                    {['日', '月', '火', '水', '木', '金', '土'].map((day, index) => (
                                        <div key={index} className="flex-none">
                                            <input
                                                type="checkbox"
                                                id={`day-${index}`}
                                                className="day-checkbox"
                                                checked={includedDays.includes(index)}
                                                onChange={() => handleDayToggle(index)}
                                            />
                                            <label
                                                htmlFor={`day-${index}`}
                                                className="day-label"
                                            >
                                                {day}
                                            </label>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="col-span-2">
                                <label className={`block mb-1 ${selectedCalendars.length === 0 ? 'font-bold text-red-400' : 'text-D1D5DB'}`}>
                                    カレンダー選択
                                </label>
                                <select
                                    multiple
                                    value={selectedCalendars}
                                    onChange={e => setSelectedCalendars(Array.from(e.target.selectedOptions, option => option.value))}
                                    className="border p-2 w-full rounded hover:border-4B5EAA bg-gray-700 text-D1D5DB transition-all duration-200 custom-scrollbar"
                                >
                                    {calendars.map(calendar => (
                                        <option key={calendar.id} value={calendar.id}>
                                            {calendar.summary}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </div>

                    <button
                        className="custom-button px-4 py-2 rounded-lg mb-4 mx-auto block shadow-lg"
                        onClick={fetchFreeTimes}
                        disabled={loading}
                    >
                        {loading ? '読み込み中...' : 'ヒマ時間を抽出'}
                    </button>

                    {freeTimes.length > 0 && (
                        <div key={freeTimes.length} className="animate-fadeIn mobile-no-scroll">
                            <div className="p-8 rounded-lg shadow-lg element-bg mb-4">
                                <h2 ref={freeTimesRef} className="text-xl font-bold mb-2 text-D1D5DB">以下の日程でご都合いかがでしょうか</h2>
                                <div className="w-full overflow-x-auto custom-scrollbar flex justify-center min-w-fit">
                                    <pre className="bg-gray-700 p-4 rounded text-sm text-D1D5DB min-w-max inline-block text-left">{formatFreeTimes()}</pre>
                                </div>
                                <div className="mt-2 text-center">
                                    <button
                                        className="custom-button px-4 py-2 rounded-lg shadow-lg"
                                        onClick={copyToClipboard}
                                    >
                                        クリップボードにコピー
                                    </button>
                                </div>
                            </div>

                            <div className="p-8 rounded-lg shadow-lg element-bg mb-4">
                                <h2 className="text-xl font-bold mb-2 text-D1D5DB">スケジュール</h2>
                                {renderTimeline()}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {isMenuOpen && (
                <div
                    className="fixed inset-0 bg-black bg-opacity-50 z-40"
                    onClick={() => setIsMenuOpen(false)}
                ></div>
            )}

            {isUsageOpen && !isGuideLoading && usageGuide && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="relative bg-gray-800 p-6 rounded-lg shadow-lg max-w-md w-full" style={{ maxHeight: '80vh' }}>
                        <button
                            className="absolute top-4 right-4 bg-black bg-opacity-50 rounded-full text-D1D5DB text-xl font-bold w-8 h-8 flex items-center justify-center p-0 z-60"
                            style={{ borderRadius: '9999px' }}
                            onClick={() => setIsUsageOpen(false)}
                        >
                            ×
                        </button>
                        <div className="overflow-y-auto custom-scrollbar" style={{ maxHeight: 'calc(80vh - 3rem)' }}>
                            <h2 className="text-2xl font-bold mb-4 text-D1D5DB">{usageGuide.title || '使い方ガイド'}</h2>
                            <p className="mb-4 text-D1D5DB">{usageGuide.description || 'ガイドが読み込まれていません。'}</p>
                            {usageGuide.steps && usageGuide.steps.map(step => (
                                <div key={step.number} className="mb-4">
                                    <h3 className="text-xl font-semibold text-D1D5DB">{step.title}</h3>
                                    <ul className="list-disc pl-5">
                                        {step.instructions && step.instructions.map((instruction, index) => (
                                            <li key={index} className="mt-2 text-D1D5DB" dangerouslySetInnerHTML={{ __html: marked.parse(instruction) }} />
                                        ))}
                                    </ul>
                                </div>
                            ))}
                            <div className="mt-4">
                                <h3 className="text-xl font-semibold text-D1D5DB">{usageGuide.tips?.title || '便利なポイント'}</h3>
                                <ul className="list-disc pl-5">
                                    {usageGuide.tips?.items && usageGuide.tips.items.map((item, index) => (
                                        <li key={index} className="mt-2 text-D1D5DB" dangerouslySetInnerHTML={{ __html: marked.parse(item) }} />
                                    ))}
                                </ul>
                            </div>
                            <div className="mt-4">
                                <h3 className="text-xl font-semibold text-D1D5DB">{usageGuide.cautions?.title || '注意点'}</h3>
                                <ul className="list-disc pl-5">
                                    {usageGuide.cautions?.items && usageGuide.cautions.items.map((item, index) => (
                                        <li key={index} className="mt-2 text-D1D5DB" dangerouslySetInnerHTML={{ __html: marked.parse(item) }} />
                                    ))}
                                </ul>
                            </div>
                            <div className="mt-4">
                                <h3 className="text-xl font-semibold text-D1D5DB">{usageGuide.support?.title || 'サポート'}</h3>
                                <p className="text-D1D5DB" dangerouslySetInnerHTML={{ __html: marked.parse(usageGuide.support?.content || 'サポート情報が利用できません。') }} />
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ページ全体の横スクロールを防ぐ
document.body.style.overflowX = 'hidden';

ReactDOM.render(<App />, document.getElementById('root'));