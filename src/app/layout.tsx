import type { Metadata } from "next";
import "./globals.css";

import Providers from './providers'
import Sidebar from "@/components/layout/sidebar";
import ReactQueryProvider from "@/app/providers/ReactQueryproviders";
import Cart from "./Pages/Cart/page";

export const metadata: Metadata = {
  title: "Omsons",
  description: "Omsons Germany",
  icons: {
    icon: "/omsons_logo.jpeg",
    shortcut: "/omsons_logo.jpeg",
    apple: "/omsons_logo.jpeg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className="antialiased">
        <ReactQueryProvider>
          {children}
        </ReactQueryProvider>
      </body>

    </html>
  );
}
