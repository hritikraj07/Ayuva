from typing import Any, Dict, List, Optional

from backend.models import Region

# Literature-inspired baseline disease compartmental transmission parameters (daily rates)
DISEASE_PARAMS: Dict[str, Dict[str, float]] = {
    "Acute Diarrhoeal Disease": {"beta": 0.30, "sigma": 1 / 2.0, "gamma": 1 / 4.0, "hosp_rate": 0.08, "vax_efficacy": 0.20},
    "Cholera": {"beta": 0.36, "sigma": 1 / 2.0, "gamma": 1 / 5.0, "hosp_rate": 0.16, "vax_efficacy": 0.55},
    "Dengue": {"beta": 0.27, "sigma": 1 / 5.0, "gamma": 1 / 7.0, "hosp_rate": 0.14, "vax_efficacy": 0.25},
    "Malaria": {"beta": 0.23, "sigma": 1 / 7.0, "gamma": 1 / 10.0, "hosp_rate": 0.15, "vax_efficacy": 0.30},
    "Food Poisoning": {"beta": 0.22, "sigma": 1 / 1.5, "gamma": 1 / 3.0, "hosp_rate": 0.05, "vax_efficacy": 0.0},
    "Chikungunya": {"beta": 0.25, "sigma": 1 / 4.0, "gamma": 1 / 7.0, "hosp_rate": 0.09, "vax_efficacy": 0.15},
    "Hepatitis A": {"beta": 0.24, "sigma": 1 / 14.0, "gamma": 1 / 14.0, "hosp_rate": 0.12, "vax_efficacy": 0.85},
    "Measles": {"beta": 0.45, "sigma": 1 / 10.0, "gamma": 1 / 8.0, "hosp_rate": 0.18, "vax_efficacy": 0.93},
    "Influenza": {"beta": 0.34, "sigma": 1 / 2.0, "gamma": 1 / 5.0, "hosp_rate": 0.06, "vax_efficacy": 0.60},
}


def run_intervention_simulation(
    *,
    region: Region,
    disease: str,
    initial_active_cases: int,
    available_beds: int,
    medical_staff: int,
    prevention_coverage_pct: float,
    vaccination_coverage_pct: float,
    budget_usd: float,
    intervention_start_day: int,
    population_override: Optional[int] = None,
) -> Dict[str, Any]:
    """Run an input-driven 30-day deterministic SEIR simulation comparing Baseline vs Intervention scenarios."""
    effective_pop = population_override if (population_override is not None and population_override > 0) else region.population
    if effective_pop is None or effective_pop <= 0:
        raise ValueError(
            f"Population is not available for {region.name} from geocoded records; please provide an explicit target population estimate."
        )

    pop_source = "user_override" if population_override else (region.geocode_source or "open_meteo_geocoding")
    params = DISEASE_PARAMS.get(
        disease,
        {"beta": 0.26, "sigma": 1 / 4.0, "gamma": 1 / 7.0, "hosp_rate": 0.10, "vax_efficacy": 0.30},
    )

    pop = float(effective_pop)
    i0 = float(max(0, initial_active_cases))
    e0 = i0 * 0.65
    r0_init = 0.0
    s0 = max(0.0, pop - i0 - e0 - r0_init)

    # Medical staffing affects effective triage/discharge efficiency when staffed adequately relative to demand
    staff_efficiency = 1.0 + min(0.30, (max(0, medical_staff) / max(1, max(available_beds, 10))) * 0.22)

    def simulate(with_intervention: bool) -> List[Dict[str, Any]]:
        s, e, i, r = s0, e0, i0, r0_init
        series: List[Dict[str, Any]] = []
        cum_cases = 0.0
        vax_applied = False

        for day in range(1, 31):
            beta = params["beta"]
            if with_intervention and day >= intervention_start_day:
                prevention_reduction = (max(0.0, min(100.0, prevention_coverage_pct)) / 100.0) * 0.48
                budget_boost = min(0.14, (max(0.0, budget_usd) / 500000.0) * 0.08)
                beta = beta * max(0.28, 1.0 - prevention_reduction - budget_boost)

                if not vax_applied and vaccination_coverage_pct > 0 and params["vax_efficacy"] > 0:
                    immunized = s * (max(0.0, min(100.0, vaccination_coverage_pct)) / 100.0) * params["vax_efficacy"]
                    s = max(0.0, s - immunized)
                    r += immunized
                    vax_applied = True

            new_exposed = (beta * s * i) / pop if pop > 0 else 0.0
            new_infectious = params["sigma"] * e
            new_recovered = params["gamma"] * i

            s = max(0.0, s - new_exposed)
            e = max(0.0, e + new_exposed - new_infectious)
            i = max(0.0, i + new_infectious - new_recovered)
            r += new_recovered
            cum_cases += new_infectious

            hosp_demand = i * params["hosp_rate"]
            if with_intervention and day >= intervention_start_day:
                hosp_demand = hosp_demand / staff_efficiency
            capacity_gap = max(0.0, hosp_demand - float(max(0, available_beds)))

            series.append(
                {
                    "day": day,
                    "daily_new_cases": round(new_infectious, 2),
                    "active_infectious": round(i, 2),
                    "cumulative_cases": round(cum_cases, 1),
                    "hospital_demand": round(hosp_demand, 2),
                    "available_beds": int(max(0, available_beds)),
                    "capacity_gap": round(capacity_gap, 2),
                }
            )
        return series

    baseline_series = simulate(False)
    intervention_series = simulate(True)

    base_total = baseline_series[-1]["cumulative_cases"]
    int_total = intervention_series[-1]["cumulative_cases"]
    cases_averted = max(0, int(round(base_total - int_total)))
    peak_base_demand = max(d["hospital_demand"] for d in baseline_series)
    peak_int_demand = max(d["hospital_demand"] for d in intervention_series)
    base_gap_days = sum(1 for d in baseline_series if d["capacity_gap"] > 0)
    int_gap_days = sum(1 for d in intervention_series if d["capacity_gap"] > 0)

    daily_comparison = [
        {
            "day": f"Day {b_pt['day']}",
            "baseline_cases": b_pt["daily_new_cases"],
            "intervention_cases": i_pt["daily_new_cases"],
            "baseline_hosp_demand": b_pt["hospital_demand"],
            "intervention_hosp_demand": i_pt["hospital_demand"],
            "baseline_beds": b_pt["available_beds"],
            "intervention_beds": i_pt["available_beds"],
            "intervention_gap": i_pt["capacity_gap"],
        }
        for b_pt, i_pt in zip(baseline_series, intervention_series)
    ]

    return {
        "region_name": region.name,
        "state": region.state,
        "disease": disease,
        "disclaimer": (
            "Mathematical compartmental SEIR projection driven solely by your supplied baseline caseload, resource capacity, "
            "and intervention parameters. Results are scenario planning projections, not empirical clinical trial outcomes."
        ),
        "input_parameters": {
            "population_used": int(effective_pop),
            "population_source": pop_source,
            "initial_active_cases": initial_active_cases,
            "available_beds": available_beds,
            "medical_staff": medical_staff,
            "prevention_coverage_pct": prevention_coverage_pct,
            "vaccination_coverage_pct": vaccination_coverage_pct,
            "budget_usd": budget_usd,
            "intervention_start_day": intervention_start_day,
        },
        "equations_and_assumptions": {
            "model": "Deterministic 30-day SEIR compartmental system",
            "equations": "dS/dt = -beta*S*I/N; dE/dt = beta*S*I/N - sigma*E; dI/dt = sigma*E - gamma*I; dR/dt = gamma*I",
            "disease_parameters": params,
            "baseline_immune_fraction_assumed": 0.0,
        },
        "summary_metrics": {
            "baseline_30d_cases": int(round(base_total)),
            "intervention_30d_cases": int(round(int_total)),
            "estimated_cases_averted": cases_averted,
            "incidence_reduction_pct": round((cases_averted / max(base_total, 1.0)) * 100.0, 1) if base_total > 0 else 0.0,
            "baseline_peak_hosp_demand": round(peak_base_demand, 1),
            "intervention_peak_hosp_demand": round(peak_int_demand, 1),
            "available_beds": int(max(0, available_beds)),
            "baseline_overload_days": base_gap_days,
            "intervention_overload_days": int_gap_days,
            "cost_per_averted_case_usd": round(budget_usd / cases_averted, 2) if cases_averted > 0 else None,
        },
        "daily_comparison": daily_comparison,
    }
