import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://geofoxapps.com"),
  title: {
    default: "Geofox Apps — Thoughtful apps for everyday life",
    template: "%s | Geofox Apps",
  },
  description:
    "GEOFOX APPS LLC creates thoughtful digital experiences. Explore NovaNook, our digital library app, and find support for Geofox products.",
  applicationName: "Geofox Apps",
  openGraph: {
    title: "Geofox Apps",
    description: "Thoughtful apps. A little more possibility in your everyday.",
    url: "https://geofoxapps.com",
    siteName: "Geofox Apps",
    type: "website",
    locale: "en_US",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
