import React, { useState } from 'react';
import { Button } from './ui.jsx';
import bugifyLogo from '../../bugify-logo.png';

export default function Navbar({ currentPage = 'home' }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const analyticsPage = currentPage === 'analytics';
  const links = analyticsPage
    ? [{ href: '/', label: 'Home' }, { href: '/analytics', label: 'Analytics' }]
    : [{ href: '/', label: 'Home' }, { href: '/#features', label: 'Features' }, { href: '/#how-it-works', label: 'How it works' }, { href: '/#about', label: 'About' }];

  return (
    <header className="site-header">
      <a className="brand" href="/" aria-label="Bugify home">
        <img src={bugifyLogo} alt="" />
        <span>BUGIFY<span className="brand-dot">.</span></span>
      </a>
      <button
        className="mobile-menu-toggle"
        type="button"
        aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <span /><span />
      </button>
      <nav className={`site-nav ${menuOpen ? 'site-nav-open' : ''}`} aria-label="Main navigation">
        {links.map((link) => (
          <a key={link.href} href={link.href} aria-current={currentPage === link.label.toLowerCase() ? 'page' : undefined} onClick={() => setMenuOpen(false)}>{link.label}</a>
        ))}
        {!analyticsPage && <a className="nav-login" href="/login" onClick={() => setMenuOpen(false)}>Login</a>}
        <Button href={analyticsPage ? '/' : '/login?mode=signup'} variant="small" onClick={() => setMenuOpen(false)}>
          {analyticsPage ? 'Back to home' : 'Get started'}
        </Button>
      </nav>
    </header>
  );
}
