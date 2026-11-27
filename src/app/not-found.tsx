export default function NotFound() {
  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', textAlign: 'center', padding: 24 }}>
      <div>
        <h1 style={{ font: '500 32px/1.2 "Frank Ruhl Libre", serif', margin: 0 }}>ההזמנה לא נמצאה</h1>
        <p style={{ color: '#66728a' }}>ייתכן שהקישור שגוי או שההזמנה עדיין לא פורסמה. בקשו מבעלי האירוע קישור מעודכן.</p>
      </div>
    </main>
  );
}
