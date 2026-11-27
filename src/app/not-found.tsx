export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-[#F8F5EF] px-6 text-center text-[#40352F]">
      <div className="max-w-sm">
        <div className="mx-auto mb-6 flex items-center justify-center gap-3 text-[#B7A08C]" aria-hidden="true">
          <i className="block h-px w-11 bg-current" /><svg width="9" height="9" viewBox="0 0 9 9"><path d="M4.5 0 9 4.5 4.5 9 0 4.5z" fill="currentColor" /></svg><i className="block h-px w-11 bg-current" />
        </div>
        <h1 className="text-[30px] font-light leading-tight">ההזמנה לא נמצאה</h1>
        <p className="mt-3 text-[17px] leading-relaxed text-[#6F5F55]">ייתכן שהקישור שגוי או שההזמנה עדיין לא פורסמה. בקשו מבעלי האירוע קישור מעודכן.</p>
      </div>
    </main>
  );
}
