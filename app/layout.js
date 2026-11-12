export const metadata = {
  title: "Caliper demo",
  description: "A small streaming chat, measured by Caliper.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#fafaf8", color: "#111" }}>{children}</body>
    </html>
  );
}
