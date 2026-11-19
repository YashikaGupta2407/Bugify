import React from 'react';
import bugifyLogo from '../../bugify-logo.png';

export default function Footer() {
  return (
    <footer className="site-footer" id="about">
      <a className="brand footer-brand" href="/" aria-label="Bugify home">
        <img src={bugifyLogo} alt="" />
        <span>BUGIFY<span className="brand-dot">.</span></span>
      </a>
      <p>Debug intelligence for the way you build.</p>
      <nav aria-label="Footer navigation">
        <a href="/#features">Features</a>
        <a href="/#how-it-works">How it works</a>
        <a href="/login">Login</a>
        <a href="/analytics">Error analytics</a>
      </nav>
      <small>© {new Date().getFullYear()} Bugify. Built for better debugging.</small>
    </footer>
  );
}
