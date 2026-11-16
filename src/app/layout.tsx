import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Zone C School Holidays — Google Home Virtual Switch",
  description:
    "Google Home Cloud-to-cloud virtual switch synced with official French Zone C school holidays.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
