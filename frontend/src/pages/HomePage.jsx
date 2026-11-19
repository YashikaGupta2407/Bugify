import React from 'react';
import Navbar from '../components/Navbar.jsx';
import Footer from '../components/Footer.jsx';
import { Button, Card, SectionLabel } from '../components/ui.jsx';

const features = [
  ['01', 'Intelligent error detection', 'Surface failures with clear context while you work.'],
  ['02', 'Root cause analysis', 'Understand why an error happened, not just what the runtime reported.'],
  ['03', 'Recommended fixes', 'Explore a practical next step and apply a suggested correction.'],
  ['04', 'Error analytics', 'See which languages and recorded error types are taking the most effort.'],
  ['05', 'Coding progress insights', 'Notice recurring mistakes and track how your debugging habits change.'],
];

function ProductPreview() {
  return (
    <div className="product-preview" aria-label="Preview of the Bugify debugging workspace">
      <div className="preview-topbar">
        <div className="window-dots" aria-hidden="true"><i /><i /><i /></div>
        <span>BUGIFY <span>/</span> DEBUG SESSION</span>
        <span className="preview-live"><i /> PREVIEW</span>
      </div>
      <div className="preview-content">
        <div className="preview-editor">
          <div className="preview-panel-heading"><span>01</span> SOURCE</div>
          <pre><span className="code-muted">01</span>  <span className="code-keyword">def</span> average(values):{'\n'}<span className="code-muted">02</span>      <span className="code-keyword">return</span> sum(values) / len(values){'\n'}<span className="code-muted">03</span>{'\n'}<span className="code-muted">04</span> print(average([]))</pre>
          <div className="preview-error-line"><span>04</span><code>ZeroDivisionError: division by zero</code></div>
        </div>
        <div className="preview-diagnosis">
          <div className="preview-panel-heading"><span>02</span> DIAGNOSTIC</div>
          <div className="preview-chip">RUNTIME ERROR</div>
          <h3>The collection is empty</h3>
          <p>The average calculation divides by the number of values. With an empty collection, that count is zero.</p>
          <div className="preview-suggestion"><span>ROOT CAUSE</span><strong>Guard against empty input before dividing.</strong></div>
          <div className="preview-cta-row"><span>View explanation</span><span>Suggested fix <b>↗</b></span></div>
        </div>
      </div>
      <div className="preview-caption">A clearer view of what your errors are telling you.</div>
    </div>
  );
}

export default function HomePage() {
  return (
    <div className="page page-home">
      <Navbar currentPage="home" />
      <main>
        <section className="hero content-width">
          <SectionLabel number="01">DEBUG INTELLIGENCE</SectionLabel>
          <h1>Understand your bugs.<br /><span>Improve your code.</span></h1>
          <p className="hero-copy">Bugify is your intelligent debugging companion that helps you understand coding mistakes, discover their root causes, and identify patterns in your programming behaviour.</p>
          <div className="hero-actions">
            <Button href="/login?mode=signup">Get started <span aria-hidden="true">↗</span></Button>
            <Button href="#features" variant="outline">Explore features</Button>
          </div>
          <div className="hero-note"><span className="status-light" /> DEBUG WITH CONTEXT. LEARN WITH EVERY ERROR.</div>
          <ProductPreview />
        </section>

        <section className="content-section content-width" id="features">
          <SectionLabel number="02">A MORE USEFUL DEBUGGING LOOP</SectionLabel>
          <div className="section-intro">
            <h2>From error message<br />to <span>understanding.</span></h2>
            <p>Move beyond the traceback. Bugify connects the failure, its cause, and a path forward in one focused workspace.</p>
          </div>
          <div className="feature-grid">
            {features.map(([number, title, description]) => (
              <Card className="feature-card" key={number}>
                <span className="feature-number">{number}</span>
                <h3>{title}</h3>
                <p>{description}</p>
                <span className="feature-arrow" aria-hidden="true">↗</span>
              </Card>
            ))}
          </div>
        </section>

        <section className="content-section how-section" id="how-it-works">
          <div className="content-width">
            <SectionLabel number="03">HOW IT WORKS</SectionLabel>
            <div className="section-intro">
              <h2>Make every error<br /><span>move you forward.</span></h2>
              <p>A practical loop that turns a moment of friction into a better mental model.</p>
            </div>
            <div className="steps-grid">
              {[
                ['01', 'Write and run your code.', 'Start with the code you are already working on.'],
                ['02', 'Understand the root cause.', 'Bugify identifies the failure and explains what led to it.'],
                ['03', 'Spot patterns over time.', 'Use Error Analytics to see repeated error types and language patterns.'],
              ].map(([number, title, detail]) => (
                <article className="step-card" key={number}>
                  <span className="step-number">{number}</span>
                  <div className="step-connector" aria-hidden="true" />
                  <h3>{title}</h3>
                  <p>{detail}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="final-cta content-width">
          <SectionLabel number="04">YOUR NEXT DEBUGGING SESSION</SectionLabel>
          <h2>Turn the next bug into<br /><span>a better insight.</span></h2>
          <p>Build a clearer picture of your code, one useful explanation at a time.</p>
          <Button href="/login?mode=signup">Get started with Bugify <span aria-hidden="true">↗</span></Button>
        </section>
      </main>
      <Footer />
    </div>
  );
}
