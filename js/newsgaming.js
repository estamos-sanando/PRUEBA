/**
 * ============================================================================
 * MALVINAS 1982 — CONTROLADOR NARRATIVO Y LUDONARRATIVO (NEWSGAMING)
 * ============================================================================
 * Misión histórica de la 2da. Escuadrilla Aeronaval de Caza y Ataque:
 *  - 4 de mayo de 1982, 11:02 hs.
 *  - Super Étendard: CC Augusto Bedacarratz (Líder) y TF Armando Mayora (Numeral).
 *  - Objetivo: Destructor Tipo 42 HMS Sheffield (D80).
 *  - Misiles: Exocet AM-39 rasantes.
 * ============================================================================
 */
(function (global) {
  "use strict";

  const Malvinas = (global.Malvinas = global.Malvinas || {});

  const STAGES = Object.freeze({
    BRIEFING: "BRIEFING",
    STEALTH_FLIGHT: "STEALTH_FLIGHT",
    COORDINATED_ATTACK: "COORDINATED_ATTACK",
    MISSILE_FLIGHT: "MISSILE_FLIGHT",
    IMPACT_AND_FIRE: "IMPACT_AND_FIRE",
    HISTORICAL_DEBRIEFING: "HISTORICAL_DEBRIEFING",
    MISSION_FAILED: "MISSION_FAILED",
  });

  class NewsgamingController {
    constructor() {
      this.stage = STAGES.BRIEFING;
      this.timeInStage = 0;
      this.totalMissionTime = 0;

      // Variables cinemáticas y tácticas de la misión
      this.distanceToTarget = 3100.0; // Metros hasta el Sheffield
      this.targetSighted = false;
      this.leaderLaunched = false;
      this.playerLaunched = false;
      this.launchReactionTime = 0;
      this.launchWindowActive = false;

      // Estadísticas de vuelo para el dossier final
      this.stats = {
        avgAltitude: 0,
        altSum: 0,
        altSamples: 0,
        maxDetection: 0,
        launchScore: "EXCELENTE",
        failReason: "",
      };

      // Misiles en vuelo 3D
      this.missiles = [];

      // Diálogos y subtítulos de radio
      this.radioBanner = {
        speaker: "",
        text: "",
        timer: 0,
      };

      // Humo / partículas del misil
      this.missileSmokeParticles = [];

      // Egress de los aviones tras el lanzamiento
      this.egressActive = false;
      this.egressOffset = 0;

      // Sprites de misiles antibuque cargados
      this.missileAssets = null;
    }

    init(assets) {
      this.missileAssets = (assets && assets.missiles) || null;
    }

    setRadio(speaker, text, duration = 4.5) {
      this.radioBanner.speaker = speaker;
      this.radioBanner.text = text;
      this.radioBanner.timer = duration;
      if (Malvinas.sound) {
        Malvinas.sound.playRadioComm();
      }
    }

    startMission() {
      this.stage = STAGES.STEALTH_FLIGHT;
      this.timeInStage = 0;
      this.totalMissionTime = 0;
      this.distanceToTarget = 3100.0;
      this.targetSighted = false;
      this.leaderLaunched = false;
      this.playerLaunched = false;
      this.launchReactionTime = 0;
      this.launchWindowActive = false;
      this.missiles = [];
      this.missileSmokeParticles = [];
      this.egressActive = false;
      this.egressOffset = 0;

      this.stats.altSum = 0;
      this.stats.altSamples = 0;
      this.stats.maxDetection = 0;
      this.stats.failReason = "";

      if (Malvinas.sound) {
        Malvinas.sound.resume();
        Malvinas.sound.startMusic();
      }

      this.setRadio(
        "LÍDER (Bedacarratz)",
        "— Tito a numeral: Mantenga 10 metros rasante. En silencio de radio absoluto hasta adquirir blanco.",
        5.2
      );
    }

    failMission(reason) {
      this.stage = STAGES.MISSION_FAILED;
      this.timeInStage = 0;
      this.stats.failReason = reason;

      if (Malvinas.sound) {
        Malvinas.sound.stopMusic();
        Malvinas.sound.stopRwrAlarm();
        Malvinas.sound.playFailureSound();
      }
    }

    triggerPlayerLaunch(flight, enemiesLayer) {
      if (this.playerLaunched || this.stage !== STAGES.COORDINATED_ATTACK) return false;

      this.playerLaunched = true;
      this.stage = STAGES.MISSILE_FLIGHT;
      this.timeInStage = 0;

      // Crear misil de Mayora (jugador) desprendiéndose del pilón derecho
      const sheffield = enemiesLayer && enemiesLayer.ships ? enemiesLayer.ships[0] : null;
      const targetX = sheffield ? sheffield.x : -80.0;
      const targetZ = sheffield ? sheffield.z : 1200;

      this.missiles.push({
        id: "MAYORA_AM39",
        owner: "player",
        x: 14.0,
        y: Math.max(3.0, flight.altitudeMeters - 1.2),
        z: 60.0,
        vx: 0,
        vy: -4.5, // Cae por gravedad inicialmente
        vz: 360.0, // Velocidad inicial antes de acelerar
        engineLit: false,
        igniteTimer: 0.45, // Cae durante ~0.45s antes de encender booster
        smokeTimer: 0,
        hit: false,
        targetX: targetX,
        targetZ: targetZ,
      });

      if (Malvinas.sound) {
        Malvinas.sound.playMissileRelease();
      }

      this.setRadio(
        "COEQUIPER (Mayora)",
        "— ¡Gatillo accionado! El Exocet se desprendió... segundos eternos...",
        3.5
      );

      return true;
    }

    update(dt, camera, flight, enemiesLayer) {
      this.timeInStage += dt;
      this.totalMissionTime += dt;

      // Actualizar temporizador de radio
      if (this.radioBanner.timer > 0) {
        this.radioBanner.timer -= dt;
      }

      // Registro de estadísticas de vuelo
      if (
        this.stage === STAGES.STEALTH_FLIGHT ||
        this.stage === STAGES.COORDINATED_ATTACK
      ) {
        this.stats.altSum += flight.altitudeMeters;
        this.stats.altSamples++;
        this.stats.avgAltitude = this.stats.altSum / this.stats.altSamples;
        if (flight.detectionLevel > this.stats.maxDetection) {
          this.stats.maxDetection = flight.detectionLevel;
        }

        // Comprobar condiciones de fallo
        if (flight.crashed) {
          this.failMission("COLISIÓN EN EL MAR: El avión impactó contra el oleaje del Atlántico Sur.");
          return;
        }
        if (flight.detected) {
          this.failMission("DETECTADOS POR EL RADAR: El radar Type 965 del HMS Sheffield activó los misiles Sea Dart.");
          return;
        }

        // Sonido de alerta RWR si se vuela demasiado alto
        if (Malvinas.sound) {
          if (flight.altitudeMeters > 15.0) {
            Malvinas.sound.startRwrAlarm();
          } else {
            Malvinas.sound.stopRwrAlarm();
          }
        }
      }

      // ----------------------------------------------------------------------
      // MÁQUINA DE ESTADOS LUDONARRATIVA
      // ----------------------------------------------------------------------
      const sheffield = enemiesLayer && enemiesLayer.ships ? enemiesLayer.ships[0] : null;

      switch (this.stage) {
        case STAGES.STEALTH_FLIGHT: {
          // El caza vuela rasante acercándose al objetivo
          const approachSpeed = (flight.knots * 1852) / 3600; // m/s (~220 m/s)
          this.distanceToTarget -= approachSpeed * dt * 0.45;

          // Colocar al Sheffield acercándose de forma coordinada
          if (sheffield) {
            sheffield.z = this.distanceToTarget;
            sheffield.x = -80.0;
            sheffield.damageState = 0;
          }

          // Notificaciones de radio progresivas
          if (this.distanceToTarget <= 2400 && !this.targetSighted) {
            this.targetSighted = true;
            this.setRadio(
              "LÍDER (Bedacarratz)",
              "— Contacto radar a las 11 en punto. Destructor clase Sheffield navegando a rumbo 110.",
              4.5
            );
          }

          // Transición a ataque coordinado al entrar en rango de disparo (~1450m)
          if (this.distanceToTarget <= 1450) {
            this.stage = STAGES.COORDINATED_ATTACK;
            this.timeInStage = 0;
            this.launchWindowActive = true;
            this.setRadio(
              "LÍDER (Bedacarratz)",
              "— ¡¡LANZAR, AHORA!! —",
              4.0
            );

            // Bedacarratz (Líder) lanza su misil primero desde su aeronave en formación (Z=260)
            if (!this.leaderLaunched) {
              this.leaderLaunched = true;
              this.missiles.push({
                id: "BEDACARRATZ_AM39",
                owner: "leader",
                x: -73.0,
                y: 12.0,
                z: 260.0,
                vx: -3.0,
                vy: -4.5,
                vz: 380.0,
                engineLit: false,
                igniteTimer: 0.35,
                smokeTimer: 0,
                hit: false,
                targetX: sheffield ? sheffield.x - 26 : -106,
                targetZ: sheffield ? sheffield.z : 1300,
              });
              if (Malvinas.sound) {
                Malvinas.sound.playMissileRelease();
              }
            }
          }
          break;
        }

        case STAGES.COORDINATED_ATTACK: {
          this.launchReactionTime += dt;

          // Si el jugador tarda demasiado (> 6s), el Sheffield detecta el ataque
          if (this.launchReactionTime > 6.0 && !this.playerLaunched) {
            this.failMission("VENTANA DE TIRO PERDIDA: El tiempo de respuesta fue excesivo y el buque alertó sus defensas.");
            return;
          }

          // Continuar acercamiento
          const approachSpeed = (flight.knots * 1852) / 3600;
          this.distanceToTarget -= approachSpeed * dt * 0.4;
          if (sheffield) sheffield.z = this.distanceToTarget;

          break;
        }

        case STAGES.MISSILE_FLIGHT: {
          // Egress de la formación de Super Étendard alejándose
          if (this.egressActive) {
            this.egressOffset += 18.0 * dt;
          }
          break;
        }

        case STAGES.IMPACT_AND_FIRE: {
          // El Sheffield arde gradualmente con la columna de 30m de humo negro
          if (sheffield) {
            sheffield.damageState = 1;
            // Progresión de daño hasta la etapa final
            sheffield.explosionFrame = Math.min(8, this.timeInStage * 1.6);
          }

          // Tras 6 segundos de contemplar el impacto y la agonía del buque, mostrar debriefing
          if (this.timeInStage >= 6.8) {
            this.stage = STAGES.HISTORICAL_DEBRIEFING;
            this.timeInStage = 0;
            if (Malvinas.sound) {
              Malvinas.sound.setFireVolume(0.15);
            }
          }
          break;
        }

        case STAGES.HISTORICAL_DEBRIEFING: {
          // Pantalla final estática interactiva
          break;
        }
      }

      // Actualizar física y trayectoria 3D de misiles en vuelo
      if (this.missiles.length > 0) {
        this._updateMissiles(dt, sheffield);
      }

      // Actualizar partículas de humo del Exocet
      for (let i = this.missileSmokeParticles.length - 1; i >= 0; i--) {
        const p = this.missileSmokeParticles[i];
        p.life -= dt;
        p.radius += 2.2 * dt;
        if (p.life <= 0) {
          this.missileSmokeParticles.splice(i, 1);
        }
      }
    }

    _updateMissiles(dt, sheffield) {
      for (let i = 0; i < this.missiles.length; i++) {
        const m = this.missiles[i];
        if (m.hit) continue;

        // 1. Desprendimiento y caída gravitatoria previa a ignición
        if (!m.engineLit) {
          m.igniteTimer -= dt;
          m.y += m.vy * dt;
          m.z += m.vz * dt;
          m.x += m.vx * dt;
          if (m.y < 2.5) m.y = 2.5;

          if (m.igniteTimer <= 0) {
            m.engineLit = true;
            m.engineTime = 0;
            m.vz = 740.0; // Velocidad de crucero Mach 0.93 (~315 m/s)
            m.vy = 0;
            if (Malvinas.sound) {
              Malvinas.sound.playRocketIgnition();
            }
          }
        } else {
          // 2. Vuelo rasante a 2.5m del mar guiado al destructor
          m.engineTime = (m.engineTime || 0) + dt;
          m.z += m.vz * dt;
          m.y += (2.5 - m.y) * Math.min(1, 6 * dt);

          if (sheffield) {
            const targetX = m.owner === "player" ? sheffield.x : sheffield.x - 26;
            m.x += (targetX - m.x) * Math.min(1, 4.2 * dt);
          }

          // Emisión de humo denso de propulsante sólido
          m.smokeTimer += dt;
          if (m.smokeTimer >= 0.02) {
            m.smokeTimer = 0;
            this.missileSmokeParticles.push({
              x: m.x + (Math.random() * 2 - 1) * 1.2,
              y: m.y + (Math.random() * 2 - 1) * 0.6,
              z: m.z - 5.0,
              life: 0.85,
              maxLife: 0.85,
              radius: 1.4 + Math.random() * 1.2,
            });
          }

          // Comprobar impacto en el Sheffield
          if (sheffield && m.z >= sheffield.z - 12) {
            m.hit = true;
            if (m.owner === "player") {
              this.stage = STAGES.IMPACT_AND_FIRE;
              this.timeInStage = 0;
              this.egressActive = true;

              sheffield.damageState = 1;
              sheffield.explosionFrame = 0;
              sheffield.hp = 0;

              if (Malvinas.sound) {
                Malvinas.sound.playShipImpact();
              }

              this.setRadio(
                "HISTORIA",
                "¡IMPACTO DIRECTO! Penetra banda de estribor a 2.5m sobre la flotación. Fuego incontrolable.",
                6.0
              );
            }
          }
        }
      }
    }

    render(ctx, camera, projectWorldPoint) {
      ctx.save();

      // 1. Renderizar partículas de humo del Exocet en perspectiva 3D
      for (let i = 0; i < this.missileSmokeParticles.length; i++) {
        const p = this.missileSmokeParticles[i];
        const proj = projectWorldPoint(p.x, p.y, p.z, camera);
        if (!proj) continue;

        const alpha = Math.max(0, p.life / p.maxLife) * 0.65;
        const rad = Math.max(1.0, Math.min(12, p.radius * proj.scale * 1.8));

        ctx.fillStyle = `rgba(235, 242, 255, ${alpha})`;
        ctx.beginPath();
        ctx.arc(proj.screenX, proj.screenY, rad, 0, Math.PI * 2);
        ctx.fill();
      }

      // 2. Renderizar misiles Exocet AM-39 en 3D con proporciones auténticas y pixel-art 16 bits
      const ma = this.missileAssets;

      for (let i = 0; i < this.missiles.length; i++) {
        const m = this.missiles[i];
        if (m.hit) continue;

        const proj = projectWorldPoint(m.x, m.y, m.z, camera);
        if (!proj) continue;

        const mx = Math.round(proj.screenX);
        const my = Math.round(proj.screenY);

        // 2a. Estela de espuma y salpicadura rasante sobre el mar justo debajo del misil (a 2.5m de cota)
        const seaProj = projectWorldPoint(m.x, 0.2, m.z, camera);
        if (seaProj && m.engineLit) {
          const seaW = Math.max(8, Math.round(28 * proj.scale));
          const seaH = Math.max(1, Math.round(5 * proj.scale));
          ctx.fillStyle = "rgba(225, 245, 255, 0.65)";
          ctx.fillRect(Math.round(seaProj.screenX - seaW * 0.5), Math.round(seaProj.screenY), seaW, seaH);
        }

        // 2b. Selección de sprite de pixel-art auténtico proporcionado
        let sprite = null;
        if (ma) {
          if (!m.engineLit) {
            sprite = m.owner === "leader" ? ma.misil || ma.misil1 : ma.misil1 || ma.misil;
          } else {
            if ((m.engineTime || 0) < 0.16 && ma.misil3) {
              sprite = ma.misil3; // Anillo de choque e ignición cohete
            } else if (m.owner === "leader" && ma.misil) {
              sprite = ma.misil; // Vista en perspectiva 3/4 hacia el blanco
            } else {
              const pulse = Math.floor((m.engineTime || 0) * 14) % 2 === 0;
              sprite = (pulse && ma.misil4) ? ma.misil4 : (ma.misil2 || ma.misil1);
            }
          }
        }

        if (sprite) {
          const spriteW = Math.max(8, Math.min(38, Math.round(sprite.width * proj.scale * 0.18)));
          const spriteH = Math.max(4, Math.round(spriteW * (sprite.height / sprite.width)));
          ctx.drawImage(
            sprite,
            mx - (spriteW >> 1),
            my - (spriteH >> 1),
            spriteW,
            spriteH
          );

          if (m.engineLit) {
            const fLen = Math.max(4, Math.round(spriteW * 0.45));
            ctx.fillStyle = "rgba(255, 160, 40, 0.75)";
            ctx.beginPath();
            ctx.arc(mx - (spriteW >> 1), my, Math.max(2, spriteH * 0.35), 0, Math.PI * 2);
            ctx.fill();
          }
        } else {
          // Representación aerodinámica esbelta del misil Exocet rasante
          const mW = Math.max(6, Math.min(24, Math.round(16 * proj.scale)));
          const mH = Math.max(2, Math.min(5, Math.round(3.0 * proj.scale)));

          if (m.engineLit) {
            const flameLen = Math.max(4, Math.round(mW * 0.75));
            ctx.fillStyle = "rgba(255, 175, 45, 0.85)";
            ctx.beginPath();
            ctx.moveTo(mx - (mW >> 1), my - (mH >> 1));
            ctx.lineTo(mx - (mW >> 1) - flameLen, my);
            ctx.lineTo(mx - (mW >> 1), my + (mH >> 1));
            ctx.closePath();
            ctx.fill();
          }

          // Fuselaje esbelto en gris naval y ojiva blanca
          ctx.fillStyle = "#64748b";
          ctx.fillRect(mx - (mW >> 1), my - (mH >> 1), mW, mH);
          ctx.fillStyle = "#e2e8f0";
          ctx.fillRect(mx + (mW >> 1) - 3, my - (mH >> 1), 3, mH);
        }
      }
      ctx.restore();
    }
  }

  Malvinas.STAGES = STAGES;
  Malvinas.NewsgamingController = NewsgamingController;
  Malvinas.newsgaming = new NewsgamingController();
})(window);

