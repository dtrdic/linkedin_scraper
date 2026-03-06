const btn = document.getElementById("startBtn")
const status = document.getElementById("status")
const table = document.querySelector("#results tbody")

btn.onclick = async () => {

  status.innerText = "Scraping LinkedIn..."

  const res = await fetch("/scrape", {
    method: "POST"
  })

  const data = await res.json()

  status.innerText = `Found ${data.length} leads`

  table.innerHTML = ""

  data.forEach(lead => {

    const row = `
      <tr>
        <td>${lead.name}</td>
        <td>${lead.company}</td>
        <td>${lead.text}</td>
        <td>${lead.score}</td>
        <td>${lead.leadType}</td>
      </tr>
    `

    table.innerHTML += row
  })
}