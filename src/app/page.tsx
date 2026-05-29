"use client"

import Link from "next/link";

export default function Home() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[url('/banner.png')] bg-cover bg-center bg-no-repeat font-sans flex flex-col">
    <div className="absolute inset-0 bg-white/75 dark:bg-black/55" />
    <header className="relative z-10 flex items-center justify-between px-8 py-5 border-b border-gray-200/70 bg-white/50 backdrop-blur-sm dark:border-neutral-800/70 dark:bg-black/35">
      <h1 className="text-xl font-light tracking-wide text-gray-900 dark:text-white">
        Omsons
      </h1>
      <nav className="flex items-center space-x-8">
        <a href="#" className="text-sm text-gray-600 dark:text-neutral-400 hover:text-gray-900 dark:hover:text-white transition">
          Home
        </a>
        <a href="#" className="text-sm text-gray-600 dark:text-neutral-400 hover:text-gray-900 dark:hover:text-white transition">
          Products
        </a>
        <a href="#" className="text-sm text-gray-600 dark:text-neutral-400 hover:text-gray-900 dark:hover:text-white transition">
          About
        </a>
        <a href="#" className="text-sm text-gray-600 dark:text-neutral-400 hover:text-gray-900 dark:hover:text-white transition">
          Contact
        </a>
      </nav>
    </header>

    <section className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 py-32">
      <div className="max-w-2xl text-center">
        <h2 className="text-5xl md:text-6xl font-light tracking-tight text-gray-900 dark:text-white mb-6">
          Welcome to Omsons
        </h2>
        <p className="text-base text-gray-600 dark:text-neutral-400 leading-relaxed mb-12">
          Discover a world of innovation and customer-first solutions. Built with simplicity and scale in mind.
        </p>

       
      </div>

      <div className="space-y-3 w-full max-w-xs">
        <p className="text-xs text-gray-500 dark:text-neutral-600 text-center mb-4">
          Get started with Omsons
        </p>
        <Link href="/auth/login">
        <button className="w-full px-6 py-3 text-sm font-medium text-gray-900 dark:text-white bg-gray-100 dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded hover:bg-gray-200 dark:hover:bg-neutral-800 transition-colors duration-200">
          Sign In
        </button>
        </Link>      
      </div>
    </section>

    
  </div>
  );
}
