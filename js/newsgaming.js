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
      const targetX = sheffield ? sheffield.x : 0;
      const targetZ = sheffield ? sheffield.z : 900;

      this.missiles.push({
        id: "MAYORA_AM39",
        owner: "player",
        x: 16.0,
        y: flight.altitudeMeters - 1.2,
        z: 75.0,
        vx: 0,
        vy: -7.5, // Cae por gravedad inicialmente
        vz: 350.0, // Velocidad inicial antes de acelerar
        engineLit: false,
        igniteTimer: 0.82, // Cae durante ~0.8s antes de encender booster
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

            // Bedacarratz (Líder) lanza su misil primero
            if (!this.leaderLaunched) {
              this.leaderLaunched = true;
              this.missiles.push({
                id: "BEDACARRATZ_AM39",
                owner: "leader",
                x: -65.0,
                y: 11.5,
                z: 110.0,
                vx: -8.0,
                vy: -6.0,
                vz: 340.0,
                engineLit: false,
                igniteTimer: 0.65,
                smokeTimer: 0,
                hit: false,
                targetX: sheffield ? sheffield.x - 30 : -110,
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
          // El Exocet de Mayora y el de Bedacarratz vuelan hacia el blanco
          let anyMissileAlive = false;

          for (let i = 0; i < this.missiles.length; i++) {
            const m = this.missiles[i];
            if (m.hit) continue;

            anyMissileAlive = true;

            // Ignición tras caída libre
            if (!m.engineLit) {
              m.igniteTimer -= dt;
              m.y += m.vy * dt;
              m.z += m.vz * dt;
              // No dejar caer por debajo de 2.5m de rasante
              if (m.y < 2.5) m.y = 2.5;

              if (m.igniteTimer <= 0) {
                m.engineLit = true;
                m.vz = 720.0; // Mach 0.93 (~315 m/s)
                m.vy = 0;
                if (Malvinas.sound) {
                  Malvinas.sound.playRocketIgnition();
                }
              }
            } else {
              // Vuelo rasante a 2.5m del agua guiado hacia el blanco
              m.z += m.vz * dt;
              m.y += (2.5 - m.y) * Math.min(1, 5 * dt);

              // Guiado terminal hacia la posición X del Sheffield
              if (sheffield) {
                const targetOffset = m.owner === "player" ? 0 : -25;
                m.x += (sheffield.x + targetOffset - m.x) * Math.min(1, 4.5 * dt);
              }

              // Emisión de partículas de humo de propulsante sólido
              m.smokeTimer += dt;
              if (m.smokeTimer >= 0.02) {
                m.smokeTimer = 0;
                this.missileSmokeParticles.push({
                  x: m.x + (Math.random() * 2 - 1) * 1.5,
                  y: m.y + (Math.random() * 2 - 1) * 0.8,
                  z: m.z - 6.0,
                  life: 1.0,
                  maxLife: 0.8 + Math.random() * 0.4,
                  radius: 1.8 + Math.random() * 1.5,
                });
              }

              // Comprobar impacto en el Sheffield
              if (sheffield && m.z >= sheffield.z - 15) {
                m.hit = true;
                if (m.owner === "player") {
                  // IMPACTO HISTÓRICO CONFIRMADO
                  this.stage = STAGES.IMPACT_AND_FIRE;
                  this.timeInStage = 0;
                  this.egressActive = true;

                  if (sheffield) {
                    sheffield.damageState = 1;
                    sheffield.explosionFrame = 0;
                    sheffield.hp = 0;
                  }

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

    render(ctx, camera, projectWorldPoint) {
      // 1. Renderizar partículas de humo del Exocet en perspectiva 3D
      ctx.save();
      for (let i = 0; i < this.missileSmokeParticles.length; i++) {
        const p = this.missileSmokeParticles[i];
        const proj = projectWorldPoint(p.x, p.y, p.z, camera);
        if (!proj) continue;

        const alpha = Math.max(0, p.life / p.maxLife) * 0.75;
        const rad = Math.max(1.5, p.radius * proj.scale * 2.8);

        ctx.fillStyle = `rgba(240, 245, 255, ${alpha})`;
        ctx.beginPath();
        ctx.arc(proj.screenX, proj.screenY, rad, 0, Math.PI * 2);
        ctx.fill();
      }

      // 2. Renderizar misiles Exocet AM-39 en 3D
      for (let i = 0; i < this.missiles.length; i++) {
        const m = this.missiles[i];
        if (m.hit) continue;

        const proj = projectWorldPoint(m.x, m.y, m.z, camera);
        if (!proj) continue;

        const mW = Math.max(5, 48 * proj.scale);
        const mH = Math.max(2, 14 * proj.scale);

        // Cuerpo del Exocet AM-39 (blanco / gris naval con aletas cruciformes)
        ctx.fillStyle = "#e2e8f0";
        ctx.fillRect(
          proj.screenX - mW * 0.5,
          proj.screenY - mH * 0.5,
          mW,
          mH
        );

        // Ojiva cónica frontal
        ctx.fillStyle = "#cbd5e1";
        ctx.beginPath();
        ctx.moveTo(proj.screenX + mW * 0.5, proj.screenY);
        ctx.lineTo(proj.screenX + mW * 0.5 + mH * 0.6, proj.screenY);
        ctx.lineTo(proj.screenX + mW * 0.5, proj.screenY + mH * 0.4);
        ctx.closePath();
        ctx.fill();

        // Aletas de estabilización
        ctx.fillStyle = "#475569";
        ctx.fillRect(
          proj.screenX - mW * 0.2,
          proj.screenY - mH * 0.9,
          mW * 0.25,
          mH * 1.8
        );

        // Llama del propulsor de cohete si está encendido
        if (m.engineLit) {
          const flameLen = (Math.random() * 0.6 + 0.8) * mW * 0.8;
          ctx.fillStyle = "#ffb020";
          ctx.beginPath();
          ctx.moveTo(proj.screenX - mW * 0.5, proj.screenY - mH * 0.4);
          ctx.lineTo(proj.screenX - mW * 0.5 - flameLen, proj.screenY);
          ctx.lineTo(proj.screenX - mW * 0.5, proj.screenY + mH * 0.4);
          ctx.closePath();
          ctx.fill();

          // Núcleo blanco caliente
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(
            proj.screenX - mW * 0.5 - flameLen * 0.4,
            proj.screenY - mH * 0.2,
            flameLen * 0.4,
            mH * 0.4
          );
        }
      }
      ctx.restore();
    }
  }

  Malvinas.STAGES = STAGES;
  Malvinas.NewsgamingController = NewsgamingController;
  Malvinas.newsgaming = new NewsgamingController();
})(window);

