    const map = mapRef.current;
    if (map?.isStyleLoaded()) syncMapData(map, routeRef.current, currentPositionRef.current, next);
  };

  return (
    <main className="go-nav">
      <header className="go-nav__header">
        <div>
          <p className="go-nav__eyebrow">GODAC · MODULE CHAUFFEUR</p>
          <h1>GO <span>Navigation</span></h1>
        </div>
        <span className={`go-nav__gps go-nav__gps--${gpsStatus}`}>{gpsStatus === 'active' ? 'GPS actif' : gpsStatus === 'locating' ? 'Recherche GPS…' : gpsStatus === 'error' ? 'GPS indisponible' : 'GPS arrêté'}</span>
      </header>

      <section className="go-nav__layout">
        <aside className="go-nav__panel">
          <button className="go-nav__primary" type="button" onClick={startGps}>
            {gpsStatus === 'active' ? 'Reprendre / actualiser le GPS' : 'Démarrer la navigation GPS'}
          </button>

          <form className="go-nav__search" onSubmit={searchAddress}>
            <label htmlFor="go-nav-search">Rechercher une adresse ou une entreprise</label>
            <div className="go-nav__search-row">
              <input id="go-nav-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nom d’entreprise, rue, ville…" />
              <button type="submit" disabled={searching}>{searching ? '…' : 'Chercher'}</button>
            </div>
          </form>

          {searchResults.length > 0 && (
            <div className="go-nav__results" role="list" aria-label="Résultats de recherche">
              {searchResults.map((result) => (
                <button type="button" key={result.place_id} onClick={() => { setDestination({ label: result.display_name, latitude: Number(result.lat), longitude: Number(result.lon) }); setSearchResults([]); }}>
                  {result.display_name}
                </button>
              ))}
            </div>
          )}

          {destinationState && (
            <div className="go-nav__destination">
              <span className="go-nav__label">DESTINATION</span>
              <strong>{destinationState.label}</strong>
              {route && <div className="go-nav__metrics"><span>{formatDistance(route.distance)}</span><span>{formatDuration(route.duration)}</span></div>}
              <button type="button" className="go-nav__secondary" onClick={() => { setDestinationState(null); destinationRef.current = null; setRoute(null); routeRef.current = null; const map = mapRef.current; if (map?.isStyleLoaded()) syncMapData(map, null, currentPositionRef.current, reports); }}>Effacer l’itinéraire</button>
            </div>
          )}

          {mappedStops.length > 0 && (
            <section className="go-nav__stops">
              <button type="button" className="go-nav__section-toggle" onClick={() => setShowStops((v) => !v)}>
                <span>Tournée du jour ({mappedStops.length} arrêts)</span><span>{showStops ? '−' : '+'}</span>
              </button>
              <button
                type="button"
                className="go-nav__primary"
                disabled={mappedStops.filter((stop) => !stop.completed).length === 0}
                onClick={() => {
                  const remainingStops = mappedStops
                    .filter((stop) => !stop.completed)
                    .map((stop) => ({
                      label: stop.label,
                      latitude: Number(stop.latitude),
                      longitude: Number(stop.longitude),
                    }));

                  if (remainingStops.length === 0) {
                    setError("Il ne reste aucun arrêt à desservir.");
                    return;
                  }

                  routeStopsRef.current = remainingStops;
                  const lastStop = remainingStops[remainingStops.length - 1];
                  setDestinationState(lastStop);
                  destinationRef.current = lastStop;

                  if (currentPositionRef.current) {
                    void calculateRoute(currentPositionRef.current, remainingStops);
                  } else {
                    setError("Démarre le GPS pour calculer l’itinéraire complet.");
                  }
                }}
              >
                Calculer toute la tournée
              </button>
              {showStops && mappedStops.map((stop, index) => (
                <button type="button" className={`go-nav__stop ${stop.completed ? 'is-complete' : ''}`} key={stop.id} onClick={() => chooseStop(stop)}>
                  <span className="go-nav__stop-index">{stop.completed ? '✓' : index + 1}</span>
                  <span className="go-nav__stop-copy"><strong>{stop.label}</strong><small>{stop.address}{stop.timeWindowLabel ? ` · ${stop.timeWindowLabel}` : ''}</small></span>
                </button>
              ))}
              {stops.length > mappedStops.length && <p className="go-nav__hint">{stops.length - mappedStops.length} arrêt(s) sans coordonnées GPS ne peuvent pas encore être routés.</p>}
            </section>
          )}

          <section className="go-nav__reports">
            <span className="go-nav__label">SIGNALER UN ÉVÉNEMENT</span>
            <label htmlFor="go-report-type">Type</label>
            <select id="go-report-type" value={reportType} onChange={(e) => setReportType(e.target.value as GoReportType)}>
              {Object.entries(reportLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <input value={reportNote} onChange={(e) => setReportNote(e.target.value)} placeholder="Précision facultative" aria-label="Précision du signalement" maxLength={160} />
            <div className="go-nav__report-actions">
              <button type="button" className="go-nav__secondary" onClick={() => setReportMode((v) => !v)}>{reportMode ? 'Annuler le placement' : 'Placer sur la carte'}</button>
              <button type="button" className="go-nav__secondary" onClick={addReport} disabled={!position}>Signaler ici</button>
            </div>
            {reportMode && <p className="go-nav__hint">Touchez la carte à l’emplacement de l’événement.</p>}
            <p className="go-nav__hint">{reports.length} signalement(s) enregistrés sur cet appareil uniquement.</p>
          </section>

          {error && <p className="go-nav__error" role="alert">{error}</p>}
          {routeBusy && <p className="go-nav__hint">Calcul de l’itinéraire…</p>}
          <p className="go-nav__disclaimer">Prototype : pas de trafic temps réel ni de profil poids lourd. Utilise les indications uniquement à l’arrêt ou avec un support sécurisé.</p>
        </aside>

        <div className={`go-nav__map-wrap ${reportMode ? 'is-reporting' : ''}`}>
          <div ref={mapElement} className="go-nav__map" aria-label="Carte de navigation" />
          <div className="go-nav__map-caption">{reportMode ? 'Touchez la carte pour placer le signalement' : position ? 'Votre position GPS est affichée' : 'Démarrez le GPS pour afficher votre position'}</div>
        </div>
      </section>
    </main>
  );
}
