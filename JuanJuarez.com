<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Juan Juarez</title>

<!-- Google Font (Apple-ish clean) -->
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">

<style>
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  body {
    font-family: 'Inter', sans-serif;
    background: #fff;
    color: #1d1d1f;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }

  header {
    position: fixed;
    width: 100%;
    padding: 20px 40px;
    display: flex;
    justify-content: space-between;
    background: rgba(255,255,255,0.8);
    backdrop-filter: blur(10px);
    border-bottom: 1px solid rgba(0,0,0,0.05);
    z-index: 1000;
  }

  header h1 {
    font-size: 0.9rem;
    font-weight: 500;
    letter-spacing: 1px;
  }

  nav a {
    margin-left: 25px;
    text-decoration: none;
    color: #6e6e73;
    font-size: 0.9rem;
    transition: 0.3s;
  }

  nav a:hover {
    color: #000;
  }

  section {
    padding: 120px 40px;
    max-width: 1100px;
    margin: auto;
  }

  .hero {
    height: 90vh;
    display: flex;
    align-items: center;
  }

  .hero h2 {
    font-size: 3.5rem;
    font-weight: 500;
    letter-spacing: -1px;
    max-width: 700px;
  }

  .hero p {
    margin-top: 20px;
    color: #6e6e73;
    font-size: 1.1rem;
  }

  .projects {
    display: grid;
    gap: 60px;
  }

  .project {
    cursor: pointer;
  }

  .project img {
    width: 100%;
    border-radius: 12px;
    transition: transform 0.6s ease;
  }

  .project:hover img {
    transform: scale(1.03);
  }

  .project h3 {
    margin-top: 15px;
    font-size: 1.4rem;
    font-weight: 500;
  }

  .project p {
    color: #6e6e73;
    font-size: 0.95rem;
  }

  .section-title {
    font-size: 2rem;
    margin-bottom: 60px;
    font-weight: 500;
  }

  .about, .services, .contact {
    max-width: 700px;
  }

  footer {
    text-align: center;
    padding: 80px 20px;
    color: #86868b;
    font-size: 0.85rem;
  }

  /* Scroll animation */
  .fade {
    opacity: 0;
    transform: translateY(40px);
    transition: all 1s ease;
  }

  .fade.visible {
    opacity: 1;
    transform: translateY(0);
  }

</style>
</head>

<body>

<header>
  <h1>JUAN JUAREZ</h1>
  <nav>
    <a href="#work">Work</a>
    <a href="#about">About</a>
    <a href="#services">Services</a>
    <a href="#contact">Contact</a>
  </nav>
</header>

<section class="hero fade">
  <div>
    <h2>Design
    <p>Architecture, systems, and spatial experimentation.</p>
  </div>
</section>

<section id="work" class="fade">
  <h2 class="section-title">Selected Work</h2>

  <div class="projects">

    <div class="project">
      <img src="https://via.placeholder.com/1200x700">
      <h3>Wind Catching System</h3>
      <p>Passive cooling using earth tubes and vertical airflow distribution.</p>
    </div>

    <div class="project">
      <img src="https://via.placeholder.com/1200x700">
      <h3>Trail Flow Concept</h3>
      <p>Exploring terrain, motion, and fluid spatial design.</p>
    </div>

  </div>
</section>

<section id="about" class="fade about">
  <h2 class="section-title">About</h2>
  <p>I’m an architecture student exploring how environmental systems and spatial design can shape experience. My work focuses on airflow, movement, and minimal form.</p>
</section>

<section id="services" class="fade services">
  <h2 class="section-title">Services</h2>
  <p>Concept design, architectural visualization, and experimental spatial systems.</p>
</section>

<section id="contact" class="fade contact">
  <h2 class="section-title">Contact</h2>
  <p>Email: your@email.com</p>
</section>

<footer>
  <p>© 2026 Juan Juarez</p>
</footer>

<script>
  const faders = document.querySelectorAll('.fade');

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if(entry.isIntersecting){
        entry.target.classList.add('visible');
      }
    });
  }, { threshold: 0.15 });

  faders.forEach(el => observer.observe(el));
</script>

</body>
</html>